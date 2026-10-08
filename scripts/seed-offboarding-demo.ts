// Demo data for the offboarding test case (Mei Tanaka): two assigned assets and two Knowledge Base
// documents she owns, so Asset Recovery and Knowledge Transfer have real items to work on. The
// offboarding logic itself is generic — it only reads assets / document ownership.
//
// Safe to re-run: assets are only added if she has none, and ownership is only set on documents
// that don't already have an explicit owner.
//
//   node scripts/run-script.mjs scripts/seed-offboarding-demo.ts
import { createAsset, getUserByEmail, getEmployeeByUserId, listAssetsByEmployee } from '@/lib/workflow-store'
import { listDocuments, setDocumentOwner } from '@/lib/document-store'

const EMPLOYEE_EMAIL = 'mei@knowledgeos.demo'
const OWNED_DOCUMENTS = ['Vendor_Master_Agreement.pdf', 'Expense Reimbursement Policy.pdf']

export async function seedOffboardingDemo() {
  const user = getUserByEmail(EMPLOYEE_EMAIL)
  const employee = user ? getEmployeeByUserId(user.id) : null
  if (!user || !employee) {
    console.log(`No employee for ${EMPLOYEE_EMAIL} — run scripts/seed-workflows.ts first.`)
    return
  }
  const name = `${employee.firstName} ${employee.lastName}`

  if (listAssetsByEmployee(employee.id).length === 0) {
    createAsset({ name: 'MacBook Pro 14"', assetType: 'laptop', serialNumber: 'MBP-2291-MT', assignedEmployeeId: employee.id, status: 'assigned' })
    createAsset({ name: 'USB-C charger (96W)', assetType: 'peripheral', serialNumber: 'CHG-96-0451', assignedEmployeeId: employee.id, status: 'assigned' })
    console.log(`Assigned 2 assets to ${name}`)
  } else {
    console.log(`${name} already has assets — skipped`)
  }

  for (const docName of OWNED_DOCUMENTS) {
    const doc = (await listDocuments()).find((d) => d.originalName === docName)
    if (!doc) {
      console.log(`Document "${docName}" not found — skipped`)
    } else if (doc.owner) {
      console.log(`"${docName}" already has an owner (${doc.owner}) — skipped`)
    } else {
      await setDocumentOwner(doc.id, name)
      console.log(`"${docName}" now owned by ${name}`)
    }
  }
}

export default seedOffboardingDemo
