import { listWorkflowsByEmployee, listEmployeeKbGrantsByEmployee } from '@/lib/workflow-store'
import type { Caller } from '@/lib/server-auth'
import type { KbAccess } from '@/lib/document-access'
import { offboardingKbCategories } from '@/lib/offboarding/access'

/**
 * Which Knowledge Base categories this caller may see, beyond the normal role/department rules in
 * lib/document-access.ts. Only an Employee who has an onboarding workflow is ever restricted:
 * until HR grants access on that workflow's knowledge_base_access step (employee_kb_grants), they
 * see nothing at all — not even "All employees" / org-wide entries — and afterward exactly the
 * granted categories (currently just Policies). Every other role, and an Employee with no
 * onboarding workflow (e.g. an existing employee being offboarded), is unaffected.
 */
export function resolveKbAccess(caller: Caller | null): KbAccess {
  if (!caller || caller.role.name !== 'Employee' || !caller.employee) return { restricted: false }

  // An employee being offboarded keeps their normal access until IT Access Deactivation runs, then
  // only the handover categories — nothing once the exit is complete (lib/offboarding/access.ts).
  // Checked first so it also applies to someone who was onboarded in-app. null = no offboarding
  // restriction, so onboarding-only employees fall through to the rule below exactly as before.
  const offboardingCategories = offboardingKbCategories(caller.employee.id)
  if (offboardingCategories) return { restricted: true, categories: offboardingCategories }

  const isOnboarding = listWorkflowsByEmployee(caller.employee.id).some((w) => w.type === 'onboarding')
  if (!isOnboarding) return { restricted: false }

  const categories = new Set<string>()
  for (const grant of listEmployeeKbGrantsByEmployee(caller.employee.id)) {
    for (const category of grant.categories) categories.add(category)
  }
  return { restricted: true, categories: Array.from(categories) }
}
