export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** SWR-compatible fetcher that identifies the demo user to the server via x-user-email. */
export function authedFetcher(email?: string | null) {
  return async (url: string) => {
    const response = await fetch(url, { headers: email ? { 'x-user-email': email } : {} })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
    }
    return response.json()
  }
}

async function authedRequest<T>(
  method: 'POST' | 'PATCH',
  url: string,
  email: string | null | undefined,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(email ? { 'x-user-email': email } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}))
    throw new ApiError(responseBody?.error ?? `Request failed (${response.status})`, response.status)
  }
  return response.json()
}

/** POST helper for the write endpoints (notify, ad-hoc step insert) — same identity header and error shape as authedFetcher. */
export function authedPost<T>(url: string, email: string | null | undefined, body?: unknown): Promise<T> {
  return authedRequest<T>('POST', url, email, body)
}

/** PATCH helper for the Tasks queue (subtask checkbox toggles, mark-complete). */
export function authedPatch<T>(url: string, email: string | null | undefined, body?: unknown): Promise<T> {
  return authedRequest<T>('PATCH', url, email, body)
}
