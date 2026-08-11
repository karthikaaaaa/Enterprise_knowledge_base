export type Department = 'HR' | 'IT' | 'Finance' | 'Legal' | 'Policies'

export type DocType = 'pdf' | 'doc' | 'sheet' | 'slides'

export type Document = {
  id: string
  name: string
  department: Department
  type: DocType
  uploadedAt: string
  size: string
  pages: number
  owner: string
  pinned: boolean
  indexed: boolean
  summary: string
  tags: string[]
  assetPath?: string
}

export const documents: Document[] = [
  {
    id: 'remote-work', name: 'Remote Work Policy', department: 'HR', type: 'pdf', uploadedAt: 'Jan 01, 2025', size: 'PDF document', pages: 3, owner: 'People Operations', pinned: true, indexed: true,
    summary: 'Flexible workplace framework covering remote classifications, approval requirements, core collaboration hours, communication expectations, equipment, internet standards, security safeguards, productivity expectations, ergonomics, and policy violations.', tags: ['Remote', 'Hybrid', 'Policy'], assetPath: '/documents/remote-work-policy.pdf',
  },
  {
    id: 'expense-policy', name: 'Expense Reimbursement Policy', department: 'Finance', type: 'pdf', uploadedAt: 'Jan 01, 2025', size: 'PDF document', pages: 4, owner: 'Finance Governance', pinned: true, indexed: true,
    summary: 'Financial governance framework defining eligible expenses, travel and lodging limits, documentation requirements, approval hierarchy, processing SLAs, and employee and manager responsibilities.', tags: ['Expenses', 'Travel', 'Finance'], assetPath: '/documents/expense-reimbursement-policy.pdf',
  },
  {
    id: 'employee-handbook', name: 'Employee Handbook 2025', department: 'HR', type: 'pdf', uploadedAt: 'Jan 01, 2025', size: 'PDF document', pages: 5, owner: 'People Operations', pinned: true, indexed: true,
    summary: 'Official 2025 employee handbook covering the KnowledgeOS mission, core values, employment classifications, flexible work, attendance, leave, ethics, anti-harassment, performance reviews, safety, IT usage, confidentiality, and administrative contacts.', tags: ['Handbook', 'Culture', 'Benefits'], assetPath: '/documents/employee-handbook-2025.pdf',
  },
  {
    id: 'brand-guidelines', name: 'Brand Guidelines Deck', department: 'Policies', type: 'slides', uploadedAt: 'Dec 02, 2024', size: 'PDF document', pages: 12, owner: 'Enterprise Brand Strategy', pinned: false, indexed: true,
    summary: 'Official KnowledgeOS Enterprise brand system defining the mission, brand pillars, logo lockups, approved color palette, typography, iconography, UI principles, brand voice, social templates, presentation layouts, and compliance guardrails.', tags: ['Brand', 'Design', 'Guidelines'], assetPath: '/documents/brand-guidelines-deck.pdf',
  },
  {
    id: 'vendor-agreement', name: 'Vendor Master Agreement', department: 'Legal', type: 'pdf', uploadedAt: 'Aug 01, 2026', size: 'PDF document', pages: 5, owner: 'Legal Operations', pinned: false, indexed: true,
    summary: 'Master agreement between KnowledgeOS Inc. and Apex Enterprise Solutions LLC covering services, work orders, payment terms, confidentiality, data protection, intellectual property, SLAs, warranties, liability, termination, dispute resolution, and governing law.', tags: ['Legal', 'Vendor', 'Procurement'], assetPath: '/documents/vendor-master-agreement.pdf',
  },
  {
    id: 'security-guidelines', name: 'IT Security Guidelines', department: 'IT', type: 'pdf', uploadedAt: 'Jan 01, 2025', size: 'PDF document', pages: 4, owner: 'Information Security', pinned: false, indexed: true,
    summary: 'Information security standard covering identity and password requirements, MFA, phishing prevention, device security, VPN, software governance, data classification, remote work security, incident escalation, and cybersecurity best practices.', tags: ['Security', 'MFA', 'Compliance'], assetPath: '/documents/it-security-guidelines.pdf',
  },
  {
    id: 'leave-policy', name: 'Leave & Time-Off Policy', department: 'HR', type: 'pdf', uploadedAt: 'Jan 01, 2025', size: 'PDF document', pages: 3, owner: 'People Operations', pinned: false, indexed: true,
    summary: 'Leave framework covering annual, casual, sick, maternity, paternity, bereavement, and public-holiday entitlements, advance notice requirements, approval workflow, carry-forward rules, forfeiture, encashment, and FAQs.', tags: ['Leave', 'PTO', 'HR'], assetPath: '/documents/leave-time-off-policy.pdf',
  },
  {
    id: 'nda-template', name: 'Mutual NDA Template', department: 'Legal', type: 'doc', uploadedAt: 'Aug 01, 2026', size: 'DOCX document', pages: 0, owner: 'Legal Operations', pinned: false, indexed: true,
    summary: 'Mutual non-disclosure agreement template. This Word document is available for download and browser preview where supported.', tags: ['Legal', 'NDA', 'Template'], assetPath: '/documents/mutual-nda-template.docx',
  },
  {
    id: 'onboarding-checklist', name: 'New Hire Onboarding Checklist', department: 'HR', type: 'sheet', uploadedAt: 'Aug 01, 2026', size: 'DOCX document', pages: 0, owner: 'People Operations', pinned: false, indexed: true,
    summary: 'New-hire onboarding checklist source document. This Word document is available for download and browser preview where supported.', tags: ['Onboarding', 'Checklist', 'HR'], assetPath: '/documents/new-hire-onboarding-checklist.docx',
  },
]

export const departments: Department[] = ['HR', 'IT', 'Finance', 'Legal', 'Policies']

export function getDocument(id: string) {
  return documents.find((d) => d.id === id)
}

export function getAssetUrl(doc: Pick<Document, 'assetPath'>) {
  return doc.assetPath ?? undefined
}
