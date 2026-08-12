import { NextResponse } from 'next/server'
import { answerQuestion } from '@/lib/rag'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const result = await answerQuestion(message)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[v0] Chat failed:', error)
    return NextResponse.json({ error: 'Failed to generate an answer. Please try again.' }, { status: 500 })
  }
}
