import { GoogleGenAI } from '@google/genai'
import { saveFile, deleteFile } from '@/lib/storage'
import { addDocument, deleteDocument, type StoredDocument } from '@/lib/document-store'
import { deleteChunksForDocument } from '@/lib/chunk-store'
import { indexDocument } from '@/lib/rag'

const SYSTEM_PROMPT =
  'You are an HR assistant compiling an internal company directory entry for a newly approved ' +
  'employee. Using only the fields provided, write a clean, factual, professional Markdown ' +
  'profile that other departments can reference: a heading with their full name, then their ' +
  'role/title, department, start date, and contact details (email, phone). Include a ' +
  '"Reporting Manager" line only if one is given. Never invent information that was not ' +
  'provided, and never include a home address, ID numbers, or any other sensitive identifying ' +
  'data — this is a public-facing directory entry, not a personnel record. Keep it concise.'

export type EmployeeProfileInput = {
  fullName: string
  email: string
  phone: string
  roleTitle: string
  department: string
  startDate: string
  managerName: string | null
}

/** A short, deterministic review summary shown alongside the full Markdown — HR should be able to
 * see at a glance what the AI included/excluded without reading the whole document. Built from
 * the input directly (not another model call) so it can never itself fail or drift from what was
 * actually saved. */
function buildProfileSummary(input: EmployeeProfileInput): string {
  const included = ['role/title', 'department', 'start date', 'email', 'phone']
  if (input.managerName) included.push('reporting manager')
  return (
    `Compiled a public directory profile for ${input.fullName} from their submitted employee details — ` +
    `includes ${included.join(', ')}. Home address, ID numbers, and other sensitive personnel data were ` +
    `deliberately left out.`
  )
}

function fallbackMarkdown(input: EmployeeProfileInput): string {
  const lines = [
    `# ${input.fullName}`,
    '',
    `- **Role:** ${input.roleTitle}`,
    `- **Department:** ${input.department}`,
    `- **Start Date:** ${input.startDate}`,
    `- **Email:** ${input.email}`,
    `- **Phone:** ${input.phone}`,
  ]
  if (input.managerName) lines.push(`- **Reporting Manager:** ${input.managerName}`)
  return lines.join('\n')
}

/** Generates the directory-style Markdown via Gemini, falling back to a plain templated version
 * if the model call fails — the KB entry should still get created either way. */
async function compileProfileMarkdown(input: EmployeeProfileInput): Promise<string> {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const profileData: Record<string, string> = {
      full_name: input.fullName,
      role_title: input.roleTitle,
      department: input.department,
      start_date: input.startDate,
      email: input.email,
      phone: input.phone,
    }
    if (input.managerName) profileData.reporting_manager = input.managerName

    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: SYSTEM_PROMPT,
      input: `New employee profile data:\n\n${JSON.stringify(profileData, null, 2)}`,
      generation_config: { max_output_tokens: 1024 },
    })

    const text = response.output_text?.trim()
    return text || fallbackMarkdown(input)
  } catch (error) {
    console.error('[v0] Gemini profile generation failed, using fallback markdown:', error)
    return fallbackMarkdown(input)
  }
}

/** Compiles an "Employee Profile" Knowledge Base entry for review and saves it right away — same
 * storage pattern as a manually uploaded document — so HR can see exactly what's being added to
 * the company directory before they verify the hr_approval step. Indexing (chunking + embedding)
 * runs fire-and-forget after, same as a manual upload, since it isn't needed for the preview.
 * Gemini failures fall back to a templated Markdown profile (see compileProfileMarkdown); a
 * storage/db failure here is real and is left to throw so the caller can surface it. */
export async function createEmployeeProfileKbEntry(
  input: EmployeeProfileInput,
): Promise<{ markdown: string; summary: string; document: StoredDocument }> {
  const markdown = await compileProfileMarkdown(input)
  const summary = buildProfileSummary(input)
  const buffer = Buffer.from(markdown, 'utf-8')
  const fileName = `${input.fullName.replace(/\s+/g, '_')}_Employee_Profile.md`
  const { storedFilename, size } = await saveFile(buffer, fileName)

  const document = await addDocument({
    originalName: `${input.fullName} — Employee Profile`,
    storedFilename,
    filePath: `storage/documents/${storedFilename}`,
    mimeType: 'text/markdown',
    size,
    department: 'HR',
    access: 'All employees',
    uploadedBy: 'AI System',
  })

  indexDocument(document).catch((error) => console.error('[v0] Failed to index employee profile KB entry:', error))

  return { markdown, summary, document }
}

/** Removes one auto-created KB entry from all three places it lives: its documents.json record,
 * its file in storage/documents/, and its chunks in storage/chunks.db (so AI Chat stops citing
 * it). Safe to call for a document that's already gone. Used by Revert, the dev reset, and
 * hr_approval regeneration — the KB lives outside workflows.db, so none of their sqlite
 * transactions can clean it up on their own. */
export async function retractKbDocument(documentId: string) {
  const removed = await deleteDocument(documentId)
  if (removed) await deleteFile(removed.storedFilename)
  await deleteChunksForDocument(documentId)
}
