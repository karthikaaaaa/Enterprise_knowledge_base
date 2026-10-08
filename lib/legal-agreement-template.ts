/**
 * The employee confidentiality agreement Legal issues from legal_verification. Fixed wording, filled
 * in with the employee's verified fields — the AI never writes or edits agreement terms. This is a
 * demo template: replace AGREEMENT_SECTIONS with counsel-approved wording before real use, and bump
 * CONFIDENTIALITY_AGREEMENT_VERSION whenever the wording changes (each issued agreement stores the
 * version and full text it was issued with).
 */

export const CONFIDENTIALITY_AGREEMENT_VERSION = 'ECA-2026.1'
const COMPANY = 'KnowledgeOS Enterprise, Inc.'

export type AgreementFields = { employeeName: string; roleTitle: string; department: string; startDate: string }

const AGREEMENT_SECTIONS = (f: AgreementFields) => [
  `This Employee Confidentiality Agreement (the "Agreement") is made between ${COMPANY} (the "Company") and ${f.employeeName} (the "Employee"), who joins the Company as ${f.roleTitle} in the ${f.department} department with a start date of ${f.startDate}.`,
  `1. Confidential Information. "Confidential Information" means all non-public information the Employee receives or creates in the course of employment, including source code, product plans, customer and employee data, financial information, and trade secrets, whether or not marked confidential.`,
  `2. Obligations. The Employee will use Confidential Information only to perform their duties, will not disclose it to anyone outside the Company without written authorisation, and will protect it with at least reasonable care.`,
  `3. Exclusions. These obligations do not apply to information that is or becomes public through no fault of the Employee, was lawfully known to the Employee before employment, or must be disclosed by law (with prompt notice to the Company where permitted).`,
  `4. Return of materials. On leaving the Company, or on request, the Employee will return or destroy all materials containing Confidential Information.`,
  `5. Duration. These obligations begin on the Employee's start date and continue during employment and for three (3) years after it ends; obligations for trade secrets continue for as long as they remain trade secrets.`,
  `6. Governing terms. This Agreement supplements the Employee's offer letter and the Company's policies. If any provision is unenforceable, the rest remains in effect.`,
  `By typing their full legal name and confirming below, the Employee agrees to the terms of this Agreement.`,
]

export function renderConfidentialityAgreement(fields: AgreementFields) {
  return {
    title: `Employee Confidentiality Agreement — ${fields.employeeName}`,
    version: CONFIDENTIALITY_AGREEMENT_VERSION,
    body: AGREEMENT_SECTIONS(fields).join('\n\n'),
  }
}
