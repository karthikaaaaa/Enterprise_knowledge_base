import { GoogleGenAI } from '@google/genai'

const SYSTEM_PROMPT =
  'You are an IT operations assistant finalizing a new employee\'s team and access assignment. ' +
  'Using only the fields provided, write a clean, factual Markdown report with three things IT ' +
  'must confirm before approving: (1) Team — the department they are placed in, plus their role/' +
  "title, (2) Start Date, and (3) Reporting Structure — describe who else is on that team (list " +
  'existing teammates by name if any are given, otherwise state this is the first confirmed ' +
  'member of that team, so there is no one to report alongside yet). Never invent a different ' +
  'team, role, date, or teammate than what was provided — this report confirms decisions already ' +
  'made, it does not make new ones. Keep it concise.'

export type TeamAssignmentInput = {
  fullName: string
  roleTitle: string
  department: string
  startDate: string
  /** Other employees already confirmed in the same department — real data, never fabricated. */
  teammates: string[]
}

function fallbackMarkdown(input: TeamAssignmentInput): string {
  return [
    `# Team & Role Assignment — ${input.fullName}`,
    '',
    `## Team`,
    `${input.department} (${input.roleTitle})`,
    '',
    `## Start Date`,
    input.startDate,
    '',
    `## Reporting Structure`,
    input.teammates.length > 0
      ? `Joins existing teammates on ${input.department}: ${input.teammates.join(', ')}.`
      : `First confirmed member of ${input.department} — no other teammates to report alongside yet.`,
  ].join('\n')
}

/** A short, deterministic review line — same rationale as hr-approval-kb's buildProfileSummary:
 * never itself fail or drift from what was actually saved. */
function buildTeamAssignmentSummary(input: TeamAssignmentInput): string {
  const teamPart =
    input.teammates.length > 0
      ? `joining ${input.teammates.length === 1 ? input.teammates[0] : `${input.teammates.length} existing teammates`} on ${input.department}`
      : `the first confirmed member of ${input.department}`
  return (
    `Confirmed ${input.fullName} as ${input.roleTitle} on the ${input.department} team, starting ` +
    `${input.startDate} — ${teamPart}.`
  )
}

async function compileTeamAssignmentMarkdown(input: TeamAssignmentInput): Promise<string> {
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const data: Record<string, unknown> = {
      full_name: input.fullName,
      role_title: input.roleTitle,
      department: input.department,
      start_date: input.startDate,
      existing_teammates_in_department: input.teammates,
    }

    const response = await client.interactions.create({
      model: 'gemini-3.6-flash',
      system_instruction: SYSTEM_PROMPT,
      input: `Team assignment data:\n\n${JSON.stringify(data, null, 2)}`,
      generation_config: { max_output_tokens: 1024 },
    })

    const text = response.output_text?.trim()
    return text || fallbackMarkdown(input)
  } catch (error) {
    console.error('[v0] Gemini team assignment report failed, using fallback markdown:', error)
    return fallbackMarkdown(input)
  }
}

/** Compiles the team/date/role confirmation report IT reviews before approving manager_approval —
 * grounded only in the employee's own submitted details plus real existing teammates in the same
 * department (never invents a team, so "looking at available teams" means cross-referencing real
 * data, not fabricating one). Mirrors hr-approval-kb.ts's compile+fallback+summary shape. */
export async function createTeamAssignmentReport(
  input: TeamAssignmentInput,
): Promise<{ markdown: string; summary: string }> {
  const markdown = await compileTeamAssignmentMarkdown(input)
  const summary = buildTeamAssignmentSummary(input)
  return { markdown, summary }
}
