import { GoogleGenAI } from '@google/genai'
import { GEMINI_REQUEST_OPTIONS } from '@/lib/gemini-request-options'

const SYSTEM_PROMPT =
  'You are an IT operations assistant giving final sign-off confirmation for a new employee. Using ' +
  "only the fields provided, write a short 2-4 sentence plain-language confirmation that their IT " +
  'account/access and standard asset kit have both already been provisioned and verified, and that ' +
  'this is ready for final IT sign-off. Never invent details beyond what is provided — this confirms ' +
  'work already done, it does not do new work. Respond with ONLY the finished summary as flowing ' +
  'prose sentences in a single paragraph — no headings, no bullet points or dashes, no numbered ' +
  'lists, and no quotation marks. Do not repeat the raw field format from the input; describe things ' +
  'naturally in sentences.'

export type ItVerificationInput = {
  fullName: string
  roleTitle: string
  department: string
  accountEmail: string
  assetSummary: string
}

function fallbackSummary(input: ItVerificationInput): string {
  return (
    `IT account and standard asset kit have been provisioned and verified for ${input.fullName} ` +
    `(${input.roleTitle}, ${input.department}). Login email ${input.accountEmail} is active and assets ` +
    `have been handed over. Ready for final IT sign-off.`
  )
}

async function compileSummary(input: ItVerificationInput): Promise<string> {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const data: Record<string, unknown> = {
      full_name: input.fullName,
      role_title: input.roleTitle,
      department: input.department,
      account_email: input.accountEmail,
      asset_allocation_summary: input.assetSummary,
    }

    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: SYSTEM_PROMPT,
      input: `IT verification data:\n\n${JSON.stringify(data, null, 2)}`,
      generation_config: { max_output_tokens: 1024 },
    }, GEMINI_REQUEST_OPTIONS)

    const text = response.output_text?.trim()
    return text || fallbackSummary(input)
  } catch (error) {
    console.error('[v0] Gemini IT verification summary failed, using fallback text:', error)
    return fallbackSummary(input)
  }
}

/** Compiles the final IT sign-off confirmation Diego reviews before approving it_verification —
 * grounded in the employee's real account email and the asset_allocation summary text, never
 * fabricated. Only ever called once it_account_creation AND asset_allocation are both verified
 * (see notifyDepartmentStep / the post-verify hook in workflow-actions.ts). Named distinctly from
 * workflow-store.ts's createItVerificationSummary (the DB insert) to avoid a same-name import
 * collision — this one generates the text, that one persists it. */
export async function generateItVerificationSummary(input: ItVerificationInput): Promise<{ summaryText: string }> {
  const summaryText = await compileSummary(input)
  return { summaryText }
}
