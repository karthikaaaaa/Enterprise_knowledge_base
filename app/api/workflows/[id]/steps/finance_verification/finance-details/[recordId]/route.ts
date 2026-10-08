import { getCaller } from '@/lib/server-auth'
import { getWorkflow, listEmployeeFinanceDetails } from '@/lib/workflow-store'

const ALLOWED_ROLES = new Set(['Finance', 'HR', 'Administrator'])

/** Streams the supporting file an employee attached to their bank/tax details, for the evidence
 * link in the finance review log. Same narrow scope as the documents route next to it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const caller = getCaller(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(caller.role.name)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id, recordId } = await params
  if (!getWorkflow(id)) return Response.json({ error: 'Workflow not found' }, { status: 404 })
  const record = listEmployeeFinanceDetails(id).find((d) => d.id === recordId)
  if (!record?.fileData) return Response.json({ error: 'File not found' }, { status: 404 })

  const safeName = (record.fileName ?? 'attachment').replace(/["\r\n]/g, '')
  return new Response(Buffer.from(record.fileData, 'base64'), {
    headers: {
      'content-type': record.fileMimeType || 'application/octet-stream',
      'content-disposition': `inline; filename="${safeName}"`,
      'cache-control': 'private, no-store',
    },
  })
}
