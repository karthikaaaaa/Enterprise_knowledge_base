const ACRONYMS = new Set(['it'])

export function humanizeStepName(stepName: string) {
  return stepName
    .split('_')
    .map((word) => {
      if (!word) return word
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase()
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function formatWorkflowDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatWorkflowDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatRelativeTime(iso: string) {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  return `${diffDay}d ago`
}
