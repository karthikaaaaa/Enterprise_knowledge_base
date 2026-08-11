import { FileText, FileSpreadsheet, Presentation, FileType } from 'lucide-react'
import type { DocType } from '@/lib/documents'
import { cn } from '@/lib/utils'

const config: Record<DocType, { icon: typeof FileText; className: string; label: string }> = {
  pdf: { icon: FileType, className: 'bg-[#ffe6e6] text-[#c0392b]', label: 'PDF' },
  doc: { icon: FileText, className: 'bg-accent text-blue-ink', label: 'DOC' },
  sheet: { icon: FileSpreadsheet, className: 'bg-[#e4f7ec] text-[#1f8a52]', label: 'XLS' },
  slides: { icon: Presentation, className: 'bg-yellow-soft text-yellow-ink', label: 'PPT' },
}

export function DocIcon({ type, size = 'md' }: { type: DocType; size?: 'md' | 'lg' }) {
  const { icon: Icon, className } = config[type]
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-2xl',
        size === 'lg' ? 'h-14 w-14' : 'h-11 w-11',
        className,
      )}
    >
      <Icon className={size === 'lg' ? 'h-7 w-7' : 'h-5 w-5'} />
    </div>
  )
}
