import { getCaller } from '@/lib/server-auth'
import { getWorkflow, listEmployeeDocumentsByWorkflow } from '@/lib/workflow-store'

const ALLOWED_ROLES = new Set(['Legal', 'HR', 'Administrator'])

/** Streams one of the employee's uploaded documents for the legal review log's evidence links.
 * Legal can't open the workflow page, so this is scoped narrowly: only documents belonging to this
 * workflow, only for Legal and HR/Administrator. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const caller = getCaller(request)
  if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(caller.role.name)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id, documentId } = await params
  if (!getWorkflow(id)) return Response.json({ error: 'Workflow not found' }, { status: 404 })
  const doc = listEmployeeDocumentsByWorkflow(id).find((d) => d.id === documentId)
  if (!doc) return Response.json({ error: 'Document not found' }, { status: 404 })

  const safeName = doc.fileName.replace(/["\r\n]/g, '')
  return new Response(Buffer.from(doc.fileData, 'base64'), {
    headers: {
      'content-type': doc.fileMimeType || 'application/octet-stream',
      'content-disposition': `inline; filename="${safeName}"`,
      'cache-control': 'private, no-store',
    },
  })
}
