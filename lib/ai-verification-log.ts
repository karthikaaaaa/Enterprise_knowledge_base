import crypto from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { GEMINI_REQUEST_OPTIONS } from '@/lib/gemini-request-options'

/**
 * Structured, auditable AI review log for "AI pre-check, then department Verify" steps.
 *
 * The split of responsibility is deliberate: everything factual — each task's status, every piece
 * of evidence, the issues, the overall status and the missing-data list — is computed in code from
 * records the step actually read (see a step's `buildFacts`). The model only writes prose: the
 * short summary for HR and a recommendation per task. Its JSON is schema-validated, retried once,
 * and replaced by deterministic text if it still doesn't validate, so a bad model reply can never
 * change a status or invent evidence.
 *
 * Only finance_verification uses this today (lib/finance-verification-log.ts); legal_verification
 * can adopt it by supplying its own AiVerificationStepConfig.
 */

export type AiLogOverallStatus = 'ready' | 'needs_attention' | 'blocked'
export type AiLogTaskStatus = 'done' | 'warning' | 'failed' | 'not_applicable'
export type AiLogEvidenceType = 'document' | 'profile_field' | 'record_created' | 'check'

export type AiLogEvidence = {
  type: AiLogEvidenceType
  label: string
  value: string
  source: string
  link?: string
}

export type AiLogTask<TaskId extends string = string> = {
  id: TaskId
  title: string
  status: AiLogTaskStatus
  actionsTaken: string[]
  evidence: AiLogEvidence[]
  issues: string[]
  recommendation: string
}

export type AiVerificationLog<TaskId extends string = string> = {
  overallStatus: AiLogOverallStatus
  shortSummary: string
  tasks: AiLogTask<TaskId>[]
  missingData: string[]
  generatedAt: string
  model: string
  runId: string
}

/** What a step's data layer produces for one task, before any model text is added. */
export type AiLogTaskFacts<TaskId extends string = string> = Omit<AiLogTask<TaskId>, 'recommendation'> & {
  /** A failed blocking task makes the whole run 'blocked' rather than 'needs_attention'. */
  blocking?: boolean
  /** Used when the model's recommendation is unavailable or invalid. */
  fallbackRecommendation: string
}

export type AiLogFacts<TaskId extends string = string> = {
  tasks: AiLogTaskFacts<TaskId>[]
  missingData: string[]
}

/** The only part of the log the model is allowed to write. */
export type AiLogNarrative<TaskId extends string = string> = {
  shortSummary: string
  tasks: { id: TaskId; recommendation: string }[]
}

export type AiVerificationStepConfig<Source, TaskId extends string> = {
  /** e.g. 'Finance verification' — used in prompts and log lines. */
  label: string
  taskIds: readonly TaskId[]
  buildFacts: (source: Source) => AiLogFacts<TaskId>
  /** Role/instructions for the model; the JSON output contract is appended automatically. */
  systemPrompt: string
  fallbackSummary: (facts: AiLogFacts<TaskId>, overallStatus: AiLogOverallStatus) => string
}

/** Generates prose for a prompt; returns the raw reply text. Injectable so tests never call a model. */
export type NarrativeGenerator = (systemPrompt: string, userInput: string) => Promise<{ text: string; model: string }>

export const FALLBACK_MODEL = 'deterministic-fallback'
const GEMINI_MODEL = 'gemini-3.6-flash'

const OVERALL_STATUSES: readonly AiLogOverallStatus[] = ['ready', 'needs_attention', 'blocked']
const TASK_STATUSES: readonly AiLogTaskStatus[] = ['done', 'warning', 'failed', 'not_applicable']
const EVIDENCE_TYPES: readonly AiLogEvidenceType[] = ['document', 'profile_field', 'record_created', 'check']

// ---------- Schema validation ----------

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Every listed task id must appear exactly once, and nothing else may. */
function checkTaskIds(ids: unknown[], allowed: readonly string[], errors: string[]) {
  for (const id of ids) {
    if (typeof id !== 'string' || !allowed.includes(id)) errors.push(`unknown task id: ${JSON.stringify(id)}`)
  }
  for (const id of allowed) {
    const count = ids.filter((x) => x === id).length
    if (count === 0) errors.push(`missing task: ${id}`)
    if (count > 1) errors.push(`duplicate task: ${id}`)
  }
}

/** Validates the model's reply against the narrative contract. */
export function validateNarrative<TaskId extends string>(
  value: unknown,
  taskIds: readonly TaskId[],
): ValidationResult<AiLogNarrative<TaskId>> {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['reply is not a JSON object'] }
  if (!isNonEmptyString(value.shortSummary)) errors.push('shortSummary must be a non-empty string')
  if (!Array.isArray(value.tasks)) {
    errors.push('tasks must be an array')
  } else {
    value.tasks.forEach((task, i) => {
      if (!isRecord(task)) errors.push(`tasks[${i}] is not an object`)
      else if (!isNonEmptyString(task.recommendation)) errors.push(`tasks[${i}].recommendation must be a non-empty string`)
    })
    checkTaskIds(value.tasks.map((t) => (isRecord(t) ? t.id : undefined)), taskIds, errors)
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      shortSummary: (value.shortSummary as string).trim(),
      tasks: (value.tasks as Record<string, unknown>[]).map((t) => ({
        id: t.id as TaskId,
        recommendation: (t.recommendation as string).trim(),
      })),
    },
  }
}

/** Validates a complete stored log — used on every read so a corrupt row is reported, not rendered. */
export function validateAiVerificationLog<TaskId extends string>(
  value: unknown,
  taskIds: readonly TaskId[],
): ValidationResult<AiVerificationLog<TaskId>> {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['log is not an object'] }
  if (!OVERALL_STATUSES.includes(value.overallStatus as AiLogOverallStatus)) errors.push('invalid overallStatus')
  if (!isNonEmptyString(value.shortSummary)) errors.push('shortSummary must be a non-empty string')
  if (!isStringArray(value.missingData)) errors.push('missingData must be a string array')
  for (const key of ['generatedAt', 'model', 'runId'] as const) {
    if (!isNonEmptyString(value[key])) errors.push(`${key} must be a non-empty string`)
  }
  if (!Array.isArray(value.tasks)) {
    errors.push('tasks must be an array')
  } else {
    value.tasks.forEach((task, i) => {
      const at = `tasks[${i}]`
      if (!isRecord(task)) {
        errors.push(`${at} is not an object`)
        return
      }
      if (!isNonEmptyString(task.title)) errors.push(`${at}.title must be a non-empty string`)
      if (!TASK_STATUSES.includes(task.status as AiLogTaskStatus)) errors.push(`${at}.status is invalid`)
      if (!isStringArray(task.actionsTaken)) errors.push(`${at}.actionsTaken must be a string array`)
      if (!isStringArray(task.issues)) errors.push(`${at}.issues must be a string array`)
      if (typeof task.recommendation !== 'string') errors.push(`${at}.recommendation must be a string`)
      if (!Array.isArray(task.evidence)) {
        errors.push(`${at}.evidence must be an array`)
      } else {
        task.evidence.forEach((ev, j) => {
          const eat = `${at}.evidence[${j}]`
          if (!isRecord(ev)) return errors.push(`${eat} is not an object`)
          if (!EVIDENCE_TYPES.includes(ev.type as AiLogEvidenceType)) errors.push(`${eat}.type is invalid`)
          for (const key of ['label', 'value', 'source'] as const) {
            if (typeof ev[key] !== 'string') errors.push(`${eat}.${key} must be a string`)
          }
          if (ev.link !== undefined && typeof ev.link !== 'string') errors.push(`${eat}.link must be a string`)
        })
      }
    })
    checkTaskIds(value.tasks.map((t) => (isRecord(t) ? t.id : undefined)), taskIds, errors)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as AiVerificationLog<TaskId> }
}

// ---------- Derived status ----------

export function computeOverallStatus(tasks: AiLogTaskFacts[]): AiLogOverallStatus {
  if (tasks.some((t) => t.status === 'failed' && t.blocking)) return 'blocked'
  if (tasks.some((t) => t.status === 'failed' || t.status === 'warning')) return 'needs_attention'
  return 'ready'
}

// ---------- Verify gating ----------

export type VerifyGateInput = { acknowledged?: boolean; comment?: string | null }
export type VerifyGateResult = { ok: true } | { ok: false; reason: 'acknowledgement_required' | 'comment_required' }

/** A 'ready' run can be verified outright. Anything flagged needs the reviewer to confirm they've
 * looked at the issues and to leave a comment saying why it's fine to proceed. */
export function checkVerifyGate(overallStatus: AiLogOverallStatus, input: VerifyGateInput): VerifyGateResult {
  if (overallStatus === 'ready') return { ok: true }
  if (!input.acknowledged) return { ok: false, reason: 'acknowledgement_required' }
  if (!input.comment || input.comment.trim().length === 0) return { ok: false, reason: 'comment_required' }
  return { ok: true }
}

// ---------- HR projection ----------

export type AiLogHrSummary = Pick<AiVerificationLog, 'overallStatus' | 'shortSummary' | 'missingData' | 'generatedAt' | 'runId'>

/** Who sees what of a structured run: the owning department (reviewing it) always gets the full
 * log; HR/Administrator get the short summary unless they explicitly open the read-only full log
 * (View Details); nobody else gets the runs at all. */
export function resolveStructuredLogView(ownerRole: string, roleName: string, requested: string | null): 'full' | 'summary' | null {
  if (roleName === ownerRole) return 'full'
  if (roleName === 'HR' || roleName === 'Administrator') return requested === 'full' ? 'full' : 'summary'
  return null
}

/** HR's timeline card gets the short summary only — no tasks, actions or evidence. */
export function toHrSummary(log: AiVerificationLog): AiLogHrSummary {
  return {
    overallStatus: log.overallStatus,
    shortSummary: log.shortSummary,
    missingData: [...log.missingData],
    generatedAt: log.generatedAt,
    runId: log.runId,
  }
}

// ---------- Runner ----------

const OUTPUT_CONTRACT = (taskIds: readonly string[]) =>
  'Respond with ONLY a JSON object, no markdown fences, of exactly this shape: ' +
  '{"shortSummary": string, "tasks": [{"id": string, "recommendation": string}]}. ' +
  `"tasks" must contain each of these ids exactly once: ${taskIds.join(', ')}. ` +
  '"shortSummary" is 2-3 plain sentences for HR covering the overall status and anything missing. ' +
  'Each "recommendation" is one or two sentences telling the reviewer what to do for that task, ' +
  'based only on its status, evidence and issues. Do not restate evidence values you were not given, ' +
  'and never describe a failed or warning task as complete.'

function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed)
}

export const geminiNarrativeGenerator: NarrativeGenerator = async (systemPrompt, userInput) => {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const response = await client.interactions.create({
    model: GEMINI_MODEL,
    system_instruction: systemPrompt,
    input: userInput,
    generation_config: { max_output_tokens: 4096, thinking_level: 'low' },
  }, GEMINI_REQUEST_OPTIONS)
  if (response.status !== 'completed') throw new Error(`interaction ended with status '${response.status}'`)
  return { text: response.output_text ?? '', model: GEMINI_MODEL }
}

/**
 * Builds the facts, asks the model for prose (one retry with the validation errors fed back), and
 * merges. The facts are passed to the model read-only; nothing it returns other than the narrative
 * fields is used.
 */
export async function runAiVerification<Source, TaskId extends string>(
  config: AiVerificationStepConfig<Source, TaskId>,
  source: Source,
  generate: NarrativeGenerator = geminiNarrativeGenerator,
): Promise<AiVerificationLog<TaskId>> {
  const facts = config.buildFacts(source)
  const overallStatus = computeOverallStatus(facts.tasks)

  const promptData = {
    overallStatus,
    missingData: facts.missingData,
    tasks: facts.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, evidence: t.evidence, issues: t.issues })),
  }
  const system = `${config.systemPrompt}\n\n${OUTPUT_CONTRACT(config.taskIds)}`
  let input = `${config.label} findings:\n\n${JSON.stringify(promptData, null, 2)}`

  let narrative: AiLogNarrative<TaskId> | null = null
  let model = FALLBACK_MODEL
  for (let attempt = 1; attempt <= 2 && !narrative; attempt++) {
    try {
      const reply = await generate(system, input)
      const result = validateNarrative(parseJsonReply(reply.text), config.taskIds)
      if (result.ok) {
        narrative = result.value
        model = reply.model
      } else {
        console.error(`[ai-log] ${config.label} attempt ${attempt} failed validation:`, result.errors)
        input += `\n\nYour previous reply was rejected: ${result.errors.join('; ')}. Reply again with valid JSON only.`
      }
    } catch (error) {
      console.error(`[ai-log] ${config.label} attempt ${attempt} failed:`, error)
      // A rate-limited model won't recover in the next second — retrying only burns quota.
      if ((error as { status?: number } | null)?.status === 429) break
    }
  }

  const recommendations = new Map(narrative?.tasks.map((t) => [t.id, t.recommendation]) ?? [])
  return {
    overallStatus,
    shortSummary: narrative?.shortSummary ?? config.fallbackSummary(facts, overallStatus),
    tasks: facts.tasks.map(({ blocking: _blocking, fallbackRecommendation, ...task }) => ({
      ...task,
      recommendation: recommendations.get(task.id) ?? fallbackRecommendation,
    })),
    missingData: facts.missingData,
    generatedAt: new Date().toISOString(),
    model,
    runId: `airun-${crypto.randomUUID()}`,
  }
}
