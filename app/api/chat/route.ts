import { NextResponse } from 'next/server'
import { answerQuestion } from '@/lib/rag'
import { getCaller } from '@/lib/server-auth'
import { resolveKbAccess } from '@/lib/kb-access'
import { listDocuments } from '@/lib/document-store'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Same grant rule as the Knowledge Base page: an onboarding Employee's answers can only draw on
    // the categories HR has granted them (nothing before the grant).
    const kbAccess = resolveKbAccess(getCaller(request))
    const allowedDocumentIds = kbAccess.restricted
      ? new Set((await listDocuments()).filter((d) => kbAccess.categories.includes(d.department)).map((d) => d.id))
      : undefined

    const result = await answerQuestion(message, allowedDocumentIds)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[v0] Chat failed:', error)
    return NextResponse.json({ error: 'Failed to generate an answer. Please try again.' }, { status: 500 })
  }
}
