import { GoogleGenAI } from '@google/genai'

/** Fixed catalog of what onboarding hands every new hire — never invented per-employee, always
 * exactly this list (see the system prompt below). */
export const STANDARD_ASSET_KIT = [
  'Laptop — standard issue (14" business laptop)',
  'Monitor — 24" external display',
  'Keyboard & mouse set',
  'Headset',
  'Building access card',
]

const SYSTEM_PROMPT =
  'You are an IT operations assistant confirming the standard asset kit assigned to a new employee. ' +
  'Using only the fields provided, write a short 3-5 sentence plain-language summary of what is being ' +
  "assigned, referencing the employee's name, role, and department for context. Never invent an item " +
  'beyond the exact list provided — this confirms assets already decided on, it does not choose new ' +
  'ones. Respond with ONLY the finished summary as flowing prose sentences in a single paragraph — ' +
  'no headings, no bullet points or dashes, no numbered lists, and no quotation marks around item ' +
  'names. Do not repeat the raw list format from the input; describe the items naturally in a sentence.'

export type AssetAllocationInput = { fullName: string; roleTitle: string; department: string }

function fallbackSummary(input: AssetAllocationInput): string {
  return (
    `${input.fullName} (${input.roleTitle}, ${input.department}) is being issued the standard asset kit: ` +
    `${STANDARD_ASSET_KIT.join(', ')}. These items will be handed over and their asset tags recorded ` +
    `against their employee ID.`
  )
}

async function compileSummary(input: AssetAllocationInput): Promise<string> {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const data: Record<string, unknown> = {
      full_name: input.fullName,
      role_title: input.roleTitle,
      department: input.department,
      standard_asset_kit: STANDARD_ASSET_KIT,
    }

    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: SYSTEM_PROMPT,
      input: `Asset allocation data:\n\n${JSON.stringify(data, null, 2)}`,
      generation_config: { max_output_tokens: 1024 },
    })

    const text = response.output_text?.trim()
    return text || fallbackSummary(input)
  } catch (error) {
    console.error('[v0] Gemini asset allocation summary failed, using fallback text:', error)
    return fallbackSummary(input)
  }
}

/** Compiles the plain-language asset kit summary Diego reviews before approving asset_allocation —
 * grounded only in the employee's real role/department and the fixed STANDARD_ASSET_KIT, never a
 * fabricated item. Called once, on Notify (see notifyDepartmentStep in workflow-actions.ts). Named
 * distinctly from workflow-store.ts's createAssetAllocationSummary (the DB insert) to avoid a
 * same-name import collision — this one generates the text, that one persists it. */
export async function generateAssetAllocationSummary(input: AssetAllocationInput): Promise<{ summaryText: string }> {
  const summaryText = await compileSummary(input)
  return { summaryText }
}
