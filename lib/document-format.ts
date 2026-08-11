export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function mimeTypeFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'pdf'
    ? 'application/pdf'
    : ext === 'txt' || ext === 'md' || ext === 'csv'
      ? 'text/plain'
      : 'application/octet-stream'
}

export function extensionToType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf' as const
  if (['xls', 'xlsx', 'csv'].includes(ext ?? '')) return 'sheet' as const
  if (['ppt', 'pptx'].includes(ext ?? '')) return 'slides' as const
  return 'doc' as const
}
