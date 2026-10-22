import type { AuditFields, Id } from './common'

export interface ImportColumn {
  sourceColumn: string
  sampleValues: string[]
  targetFieldKey: string | null
  inferredType: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'unknown'
  warnings: string[]
}

export interface ExcelImportJob extends AuditFields {
  id: Id
  fileName: string
  sheetName: string
  ownerType: 'group' | 'company'
  ownerId: Id
  status: 'uploaded' | 'mapped' | 'draft_created' | 'failed'
  columns: ImportColumn[]
  draftFormTemplateId: Id | null
  draftFormVersionId: Id | null
  errorMessage: string | null
}

export interface ImportCommitInput {
  templateName: string
  templateCode: string
  ownerType: 'group' | 'company'
  ownerId: Id
  mappings: Record<string, string | null>
}

export interface ImportResult {
  job: ExcelImportJob
  draftVersionId: Id
  warnings: string[]
}
