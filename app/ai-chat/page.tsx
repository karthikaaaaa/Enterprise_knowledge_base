import { AppShell } from '@/components/dashboard/app-shell'
import { PageHeader } from '@/components/dashboard/page-header'
import { AiChatView } from '@/components/chat/ai-chat-view'

export default function AiChatPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="AI Chat"
          title="Knowledge Assistant"
          description="Ask questions in plain language and get answers cited from your company documents."
        />
        <AiChatView />
      </div>
    </AppShell>
  )
}
