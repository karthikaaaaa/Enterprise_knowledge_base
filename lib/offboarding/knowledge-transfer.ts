import { listApprovalsByWorkflow, listAllWorkflows, getWorkflowSteps } from '@/lib/workflow-store'
import { geminiNarrativeGenerator, FALLBACK_MODEL, type NarrativeGenerator } from '@/lib/ai-verification-log'
import { listDocuments, documentOwner } from '@/lib/document-store'
import { humanizeStepName } from '@/lib/workflow-format'
import { resolveManagerUser, type OffboardingContext } from '@/lib/offboarding/context'
import type { HandoverItem } from '@/lib/offboarding/store'

/**
 * Knowledge transfer draft: what the employee owns (Knowledge Base documents) and what is still
 * assigned to them (open workflow tasks), each proposed to a new owner — their reporting manager by
 * default. The items come from records; the AI only writes the handover notes, with a deterministic
 * fallback. Nothing moves until the employee confirms and the manager accepts (actions.ts).
 */
export async function draftHandover(ctx: OffboardingContext, generate: NarrativeGenerator = geminiNarrativeGenerator) {
  const newOwner = resolveManagerUser(ctx)?.name ?? 'HR'
  const items: Omit<HandoverItem, 'id'>[] = []

  for (const doc of await listDocuments()) {
    if (documentOwner(doc) !== ctx.name) continue
    items.push({ itemType: 'kb_document', itemRef: doc.id, itemLabel: doc.originalName, currentOwner: ctx.name, newOwner })
  }

  if (ctx.user) {
    for (const workflow of listAllWorkflows()) {
      const steps = getWorkflowSteps(workflow.id)
      for (const approval of listApprovalsByWorkflow(workflow.id)) {
        if (approval.approverId !== ctx.user.id || !['allocated', 'in_progress'].includes(approval.status)) continue
        const step = steps.find((s) => s.id === approval.stepId)
        items.push({
          itemType: 'open_task',
          itemRef: approval.id,
          itemLabel: `Open task: ${step ? humanizeStepName(step.stepName) : 'workflow step'}`,
          currentOwner: ctx.name,
          newOwner,
        })
      }
    }
  }

  const fallback = [
    `Handover for ${ctx.name}${ctx.department ? ` (${ctx.department})` : ''}.`,
    items.length === 0
      ? 'No Knowledge Base documents or open tasks are recorded against this employee — confirm with them whether anything else needs handing over.'
      : `Items to hand over to ${newOwner}:\n${items.map((i) => `- ${i.itemLabel}`).join('\n')}`,
    'Add anything else the team needs: in-flight work, key contacts, recurring responsibilities, and where files live.',
  ].join('\n\n')

  let draftNotes = fallback
  let model = FALLBACK_MODEL
  try {
    const reply = await generate(
      'You are drafting a short knowledge-handover note for an employee who is leaving. Use only the items given. Plain text, no markdown headings, under 150 words. End by asking the employee to add anything not listed.',
      JSON.stringify({ employee: ctx.name, department: ctx.department, newOwner, items: items.map((i) => ({ type: i.itemType, item: i.itemLabel })) }),
    )
    if (reply.text.trim()) {
      draftNotes = reply.text.trim()
      model = reply.model
    }
  } catch (error) {
    console.error('[offboarding] handover draft failed, using fallback:', error)
  }
  return { draftNotes, model, items }
}
