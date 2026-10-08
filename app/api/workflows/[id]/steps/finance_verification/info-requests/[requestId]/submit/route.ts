import { NextResponse, after } from 'next/server'
import { getCaller } from '@/lib/server-auth'
import { submitEmployeeInfo, type SubmitInfoError } from '@/lib/employee-info-requests'

const ERROR_STATUS: Record<SubmitInfoError, number> = {
  workflow_not_found: 404,
  forbidden: 403,
  request_not_found: 404,
  request_not_open: 409,
  invalid_field: 400,
  invalid_file: 400,
}

const ERROR_MESSAGE: Record<SubmitInfoError, string> = {
  workflow_not_found: 'Workflow not found',
  forbidden: 'Forbidden',
  request_not_found: 'Request not found',
  request_not_open: 'This request has already been answered',
  invalid_field: 'Some details are missing or invalid',
  invalid_file: 'The attached file could not be accepted',
}

/** The employee answers HR's request with the details (and optionally a supporting file). The
 * ownership check lives in submitEmployeeInfo — only the workflow's own employee can submit. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const caller = getCaller(request)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, requestId } = await params
  const body = (await request.json().catch(() => null)) as {
    fields?: Record<string, unknown>
    file_name?: unknown
    file_mime_type?: unknown
    file_data?: unknown
  } | null

  const rawData = typeof body?.file_data === 'string' ? body.file_data : ''
  const dataBase64 = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData
  const file =
    dataBase64 && typeof body?.file_name === 'string' && typeof body?.file_mime_type === 'string'
      ? { fileName: body.file_name, mimeType: body.file_mime_type, dataBase64 }
      : null

  const result = await submitEmployeeInfo(
    id,
    requestId,
    caller.user.id,
    { fields: body?.fields && typeof body.fields === 'object' ? body.fields : {}, file },
    // The details are saved before responding; the AI re-run happens after the response is sent.
    { defer: (task) => after(task) },
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.message ?? ERROR_MESSAGE[result.error] }, { status: ERROR_STATUS[result.error] })
  }
  return NextResponse.json({ ok: true, rerun: result.rerun })
}
