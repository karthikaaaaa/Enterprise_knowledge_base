import { AppShell } from '@/components/dashboard/app-shell'
import { PageHeader } from '@/components/dashboard/page-header'
import { KnowledgeBaseView } from '@/components/knowledge/knowledge-base-view'

export default function KnowledgeBasePage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Knowledge Base"
          title="Company Documents"
          description="Browse, search, and manage every policy, handbook, and file across your organization."
        />
        <KnowledgeBaseView />
      </div>
    </AppShell>
  )
}
