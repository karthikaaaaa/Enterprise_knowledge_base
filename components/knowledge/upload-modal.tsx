'use client'

import { useEffect, useState } from 'react'
import { X, UploadCloud, Sparkles, FileText, CheckCircle2, Loader2 } from 'lucide-react'
import { departments } from '@/lib/documents'
import { useAuth } from '@/components/auth/auth-provider'

type UploadedDocument = { id: string; name: string; size: string; type: string; pathname: string; mimeType: string; uploadedAt: string; department: string }

export function UploadModal({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded?: (doc: UploadedDocument) => void }) {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [department, setDepartment] = useState(departments[0])
  const [access, setAccess] = useState('All employees')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!file) { setPreview(''); return }
    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv')) {
      const reader = new FileReader()
      reader.onload = () => setPreview(String(reader.result).slice(0, 1800))
      reader.readAsText(file)
    } else setPreview('')
  }, [file])

  useEffect(() => {
    if (!open) { setFile(null); setError(''); setPreview('') }
  }, [open])

  async function uploadFile() {
    if (!file) { setError('Choose a file before uploading.'); return }
    setUploading(true); setError('')
    const body = new FormData()
    body.append('file', file); body.append('department', department); body.append('access', access)
    if (user?.name) body.append('uploadedBy', user.name)
    try {
      const response = await fetch('/api/documents/upload', { method: 'POST', body })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Upload failed')
      onUploaded?.(data); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed') }
    finally { setUploading(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#16233a]/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="upload-title" className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-lift">
        <div className="flex items-start justify-between"><div><h2 id="upload-title" className="text-lg font-semibold text-foreground">Upload Document</h2><p className="mt-1 text-sm text-muted-foreground">Preview the file, then add it to your knowledge base.</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /><span className="sr-only">Close</span></button></div>
        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-secondary/60 px-6 py-8 text-center hover:border-ring hover:bg-accent/40"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><UploadCloud className="h-6 w-6" /></div><p className="text-sm font-medium text-foreground">Drag & drop or click to browse</p><p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, PPTX, TXT up to 25 MB</p><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {file ? <div className="mt-4 rounded-2xl border border-border bg-background p-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-blue-ink"><FileText className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{file.name}</p><p className="text-xs text-muted-foreground">{formatBytes(file.size)} · {file.type || 'Unknown file type'}</p></div><CheckCircle2 className="h-5 w-5 text-green-600" /></div>{preview ? <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs leading-relaxed text-muted-foreground">{preview}</pre> : <p className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">File selected. The original file will be available in the preview after upload.</p>}</div> : null}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm"><span className="mb-1.5 block font-medium text-foreground">Department</span><select value={department} onChange={(e) => setDepartment(e.target.value as typeof department)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/60">{departments.map((d) => <option key={d}>{d}</option>)}</select></label><label className="text-sm"><span className="mb-1.5 block font-medium text-foreground">Access level</span><select value={access} onChange={(e) => setAccess(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/60"><option>All employees</option><option>Department only</option><option>Admins only</option></select></label></div>
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-yellow-soft px-4 py-3"><Sparkles className="h-4 w-4 text-yellow-ink" /><p className="text-xs font-medium text-yellow-ink">AI indexing will begin after upload.</p></div>
        {error ? <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        <div className="mt-6 flex items-center justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancel</button><button type="button" disabled={uploading} onClick={uploadFile} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-60">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{uploading ? 'Uploading...' : 'Upload File'}</button></div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
