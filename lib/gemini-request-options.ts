/**
 * Per-request options for every `client.interactions.create` call (the client-level
 * `httpOptions.retryOptions` is ignored by the interactions API).
 *
 * - maxRetries 0: @google/genai 2.16's built-in retry re-sends an already-consumed request body and
 *   fails with "TypeError: unusable", so its retries never succeed — they only add backoff delay
 *   (tens of seconds per call) and turn a clear 429 rate-limit error into a vague connection
 *   error. Callers already fall back to deterministic text when the call fails.
 * - timeout: a hung request shouldn't hold an automation step for minutes.
 */
export const GEMINI_REQUEST_OPTIONS = { maxRetries: 0, timeout: 45_000 }
