import * as store from '@/lib/workflow-store'

/** Every test file shares one sandbox database (see scripts/run-tests.mjs), and a workflow resolves
 * its steps through the single onboarding template — so tests must reuse that template rather than
 * create their own. Returns the employee_details, finance_verification and legal_verification steps. */
export function onboardingSteps() {
  const template =
    store.getWorkflowTemplateByType('onboarding') ?? store.createWorkflowTemplate({ name: 'Test Onboarding', type: 'onboarding' })
  const steps = store.listTemplateSteps(template.id)
  const find = (name: string, department: string, order: number) =>
    steps.find((s) => s.stepName === name) ??
    store.createTemplateStep({ templateId: template.id, stepName: name, departmentName: department, stepOrder: order })
  return {
    details: find('employee_details', 'HR', 1),
    finance: find('finance_verification', 'Finance', 2),
    legal: find('legal_verification', 'Legal', 3),
  }
}
