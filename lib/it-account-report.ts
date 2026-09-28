import crypto from 'node:crypto'
import { GoogleGenAI } from '@google/genai'

const SYSTEM_PROMPT =
  'You are an IT operations assistant confirming a new employee\'s account and access setup. ' +
  'Using only the fields provided, write a clean, factual Markdown summary confirming: their ' +
  'company login email, their one-time temporary password, that SSO / system access has been ' +
  'configured, and their role/department for context. Explicitly note the temporary password ' +
  'must be changed on first login. Close with a one-line note that these details are being ' +
  'shared with the employee. Never invent a different email or password than what was provided — ' +
  'this report confirms an account that was already created, it does not create a new one. Keep ' +
  'it concise.'

export type ItAccountCredentialsInput = {
  fullName: string
  email: string
  roleTitle: string
  department: string
}

/** A one-time temporary password for the new account — this is a demo-only placeholder credential
 * (this app has no real mailbox/SSO provider behind it), always paired with a "change on first
 * login" note, same convention as a real IT onboarding flow. */
function generateTemporaryPassword(): string {
  const random = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
  return `Welcome${new Date().getFullYear()}!${random}`
}

function fallbackMarkdown(input: ItAccountCredentialsInput, tempPassword: string): string {
  return [
    `# Account & Access Confirmation — ${input.fullName}`,
    '',
    `- **Company Login Email:** ${input.email}`,
    `- **Temporary Password:** ${tempPassword} (must be changed on first login)`,
    `- **Role:** ${input.roleTitle}`,
    `- **Department:** ${input.department}`,
    `- **Access:** Single sign-on (SSO) configured.`,
    '',
    'These details have been shared with the employee.',
  ].join('\n')
}

function buildCredentialsSummary(input: ItAccountCredentialsInput): string {
  return `Account confirmed for ${input.fullName} (${input.roleTitle}, ${input.department}) — login email ${input.email}, SSO access configured, temporary password issued.`
}

async function compileCredentialsMarkdown(input: ItAccountCredentialsInput, tempPassword: string): Promise<string> {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const data: Record<string, string> = {
      full_name: input.fullName,
      email: input.email,
      temporary_password: tempPassword,
      role_title: input.roleTitle,
      department: input.department,
    }

    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: SYSTEM_PROMPT,
      input: `Account setup data:\n\n${JSON.stringify(data, null, 2)}`,
      generation_config: { max_output_tokens: 1024 },
    })

    const text = response.output_text?.trim()
    return text || fallbackMarkdown(input, tempPassword)
  } catch (error) {
    console.error('[v0] Gemini account credentials summary failed, using fallback markdown:', error)
    return fallbackMarkdown(input, tempPassword)
  }
}

/** Compiles the account/access confirmation IT reviews before approving it — grounded in the
 * employee's real assigned login email (their actual system account); the temporary password is
 * this demo's own placeholder credential (see generateTemporaryPassword), always shown with a
 * "change on first login" note rather than presented as a real permanent secret. Mirrors
 * hr-approval-kb.ts / manager-approval-report.ts's shape. */
export async function createItAccountCredentialsReport(
  input: ItAccountCredentialsInput,
): Promise<{ markdown: string; summary: string }> {
  const tempPassword = generateTemporaryPassword()
  const markdown = await compileCredentialsMarkdown(input, tempPassword)
  const summary = buildCredentialsSummary(input)
  return { markdown, summary }
}
