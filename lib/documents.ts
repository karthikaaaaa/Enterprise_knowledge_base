export type Department = 'HR' | 'IT' | 'Finance' | 'Legal' | 'Policies'

export type DocType = 'pdf' | 'doc' | 'sheet' | 'slides'

export type Document = {
  id: string
  name: string
  department: Department
  type: DocType
  uploadedAt: string
  size: string
  pages: number
  owner: string
  pinned: boolean
  indexed: boolean
  summary: string
  tags: string[]
  assetPath?: string
}

export const departments: Department[] = ['HR', 'IT', 'Finance', 'Legal', 'Policies']
