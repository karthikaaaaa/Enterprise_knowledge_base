export type StepStatus = 'completed' | 'in-progress' | 'pending'

export type WorkflowStep = {
  title: string
  description: string
  status: StepStatus
  meta: string
  details: string
}

export const onboardingSteps: WorkflowStep[] = [
  {
    title: 'Employee Details',
    description: 'Personal and role information collected',
    status: 'completed',
    meta: 'Completed Feb 10',
    details:
      'Full name, contact details, role, department, and start date have been captured and verified against the offer letter.',
  },
  {
    title: 'Upload Documents',
    description: 'ID, tax forms, and certifications submitted',
    status: 'completed',
    meta: 'Completed Feb 11',
    details:
      'Government ID, signed tax forms, and educational certifications uploaded to the secure document vault.',
  },
  {
    title: 'AI Document Verification',
    description: 'Automated authenticity and completeness check',
    status: 'completed',
    meta: 'Completed Feb 11',
    details:
      'All submitted documents passed automated verification for authenticity, expiry, and completeness with no flags raised.',
  },
  {
    title: 'HR Approval',
    description: 'HR review of profile and documentation',
    status: 'in-progress',
    meta: 'Awaiting Priya Nair',
    details:
      'HR is reviewing the verified profile and documentation before advancing to manager approval. Expected within 1 business day.',
  },
  {
    title: 'Manager Approval',
    description: 'Reporting manager confirms team placement',
    status: 'pending',
    meta: 'Not started',
    details:
      'The reporting manager will confirm team placement, seating, and the first-week schedule.',
  },
  {
    title: 'IT Account Creation',
    description: 'Email, SSO, and system access provisioned',
    status: 'pending',
    meta: 'Not started',
    details:
      'IT will provision corporate email, single sign-on, and role-based access to internal systems.',
  },
  {
    title: 'Asset Allocation',
    description: 'Laptop and peripherals assigned',
    status: 'pending',
    meta: 'Not started',
    details:
      'A laptop, monitor, and peripherals will be assigned and shipped or made ready for pickup.',
  },
  {
    title: 'Knowledge Base Access',
    description: 'Onboarding docs and team spaces granted',
    status: 'pending',
    meta: 'Not started',
    details:
      'Access to the onboarding handbook, department policies, and team knowledge spaces will be granted.',
  },
  {
    title: 'Completed',
    description: 'Employee fully onboarded and active',
    status: 'pending',
    meta: 'Not started',
    details: 'All onboarding steps complete. The employee is fully set up and active.',
  },
]

export const offboardingSteps: WorkflowStep[] = [
  {
    title: 'Exit Request',
    description: 'Resignation or termination logged',
    status: 'completed',
    meta: 'Completed Feb 08',
    details:
      'The exit request has been logged with the last working day and reason for departure recorded.',
  },
  {
    title: 'Manager Approval',
    description: 'Manager acknowledges the exit',
    status: 'completed',
    meta: 'Completed Feb 09',
    details:
      'The reporting manager has acknowledged the exit and confirmed the final working day.',
  },
  {
    title: 'Knowledge Transfer',
    description: 'Handover of projects and documentation',
    status: 'in-progress',
    meta: 'In progress',
    details:
      'The employee is documenting active projects and transferring ownership of key responsibilities to teammates.',
  },
  {
    title: 'Return Assets',
    description: 'Laptop, badge, and equipment returned',
    status: 'pending',
    meta: 'Not started',
    details:
      'Company laptop, access badge, and any issued peripherals must be returned and logged by IT.',
  },
  {
    title: 'Deactivate Accounts',
    description: 'Email, SSO, and system access revoked',
    status: 'pending',
    meta: 'Not started',
    details:
      'All corporate accounts and system access will be revoked on the final working day.',
  },
  {
    title: 'Finance Clearance',
    description: 'Final settlement and dues cleared',
    status: 'pending',
    meta: 'Not started',
    details:
      'Finance will process the final settlement, clear outstanding reimbursements, and confirm no pending dues.',
  },
  {
    title: 'Exit Interview',
    description: 'Feedback session with HR',
    status: 'pending',
    meta: 'Not started',
    details:
      'HR will conduct an exit interview to gather feedback and complete the offboarding record.',
  },
  {
    title: 'Completed',
    description: 'Employee fully offboarded',
    status: 'pending',
    meta: 'Not started',
    details: 'All offboarding steps complete. The employee record has been archived.',
  },
]

export type RequestItem = {
  name: string
  role: string
  type: 'Onboarding' | 'Offboarding'
  status: string
  date: string
  progress: number
}

export const recentRequests: RequestItem[] = [
  {
    name: 'Elena Petrova',
    role: 'Product Designer',
    type: 'Onboarding',
    status: 'HR Approval',
    date: 'Feb 11, 2025',
    progress: 40,
  },
  {
    name: 'James Okoro',
    role: 'Backend Engineer',
    type: 'Onboarding',
    status: 'IT Account Creation',
    date: 'Feb 09, 2025',
    progress: 65,
  },
  {
    name: 'Mei Tanaka',
    role: 'Sales Manager',
    type: 'Offboarding',
    status: 'Knowledge Transfer',
    date: 'Feb 08, 2025',
    progress: 30,
  },
  {
    name: 'Omar Haddad',
    role: 'Data Analyst',
    type: 'Onboarding',
    status: 'Completed',
    date: 'Feb 04, 2025',
    progress: 100,
  },
]
