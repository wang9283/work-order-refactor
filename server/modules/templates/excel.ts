import ExcelJS from 'exceljs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ImportColumn } from '../../../packages/contracts/src'
import { AppError } from '../../core/errors'

export interface ParsedExcel {
  sheetName: string
  columns: ImportColumn[]
  sampleRows: string[][]
  inferredSchema: {
    mainFields: Array<{
      id: string
      key: string
      name: string
      type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'single_select' | 'multi_select' | 'boolean'
      required: boolean
      strategy: 'optional'
      sort: number
      options?: Array<{ label: string; value: string }>
      isCore: boolean
      editableByLocal: boolean
    }>
    subForms: []
    conditionRules: []
  }
  warnings: string[]
}

const ALLOWED_TYPES = [
  'text', 'textarea', 'number', 'date', 'datetime', 'single_select', 'multi_select', 'boolean',
] as const

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim()
  if (typeof value === 'object' && 'result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue)
  return String(value).trim()
}

function inferType(values: string[], declared?: string): ImportColumn['inferredType'] {
  if (declared && ALLOWED_TYPES.includes(declared as (typeof ALLOWED_TYPES)[number])) {
    if (declared === 'text' || declared === 'textarea') return 'text'
    if (declared === 'single_select' || declared === 'multi_select') return 'select'
    return declared as ImportColumn['inferredType']
  }
  const filled = values.filter(Boolean)
  if (!filled.length) return 'unknown'
  if (filled.every((item) => /^-?\d+(\.\d+)?$/.test(item))) return 'number'
  if (filled.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))) return 'date'
  if (filled.every((item) => !Number.isNaN(Date.parse(item)))) return 'datetime'
  return 'text'
}

function fieldKey(name: string, index: number): string {
  const ascii = name
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  const romanizedFallback = `field_${index + 1}`
  return /^[A-Za-z]/.test(ascii) ? ascii : romanizedFallback
}

type InferredFieldType = ParsedExcel['inferredSchema']['mainFields'][number]['type']

function formType(inferred: ImportColumn['inferredType'], declared?: string): InferredFieldType {
  if (declared && ALLOWED_TYPES.includes(declared as (typeof ALLOWED_TYPES)[number])) {
    return declared as InferredFieldType
  }
  if (inferred === 'select') return 'single_select'
  if (inferred === 'unknown') return 'text'
  return inferred
}

export async function parseExcel(buffer: Buffer, originalName: string): Promise<ParsedExcel> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    throw AppError.badRequest('无法读取该 Excel，请确认文件为有效的 .xlsx 工作簿')
  }
  const worksheet = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0)
  if (!worksheet) throw AppError.badRequest('工作簿中没有可读取的数据')

  const header = worksheet.getRow(1)
  const names: string[] = []
  for (let col = 1; col <= worksheet.columnCount; col += 1) {
    names.push(cellText(header.getCell(col).value))
  }
  const duplicateNames = names.filter((name, index) => name && names.indexOf(name) !== index)
  if (duplicateNames.length) {
    throw AppError.badRequest(`Excel 存在重复字段名：${[...new Set(duplicateNames)].join('、')}`)
  }
  if (!names.some(Boolean)) throw AppError.badRequest('Excel 第一行必须填写字段名称')

  const secondRow = Array.from({ length: worksheet.columnCount }, (_, index) => cellText(worksheet.getRow(2).getCell(index + 1).value))
  const declaredTypes = secondRow.map((value) => value.startsWith('type:') ? value.slice(5).trim() : '')
  const hasTypeRow = declaredTypes.some(Boolean)
  const sampleStart = hasTypeRow ? 3 : 2
  const sampleRows: string[][] = []
  for (let rowNo = sampleStart; rowNo <= Math.min(worksheet.rowCount, sampleStart + 19); rowNo += 1) {
    const row = worksheet.getRow(rowNo)
    const values = Array.from({ length: worksheet.columnCount }, (_, index) => cellText(row.getCell(index + 1).value))
    if (values.some(Boolean)) sampleRows.push(values)
  }

  const columns: ImportColumn[] = []
  const mainFields: ParsedExcel['inferredSchema']['mainFields'] = []
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]
    if (!name) continue
    const samples = sampleRows.map((row) => row[index] || '').filter(Boolean).slice(0, 5)
    const declared = declaredTypes[index]
    if (declared && !ALLOWED_TYPES.includes(declared as (typeof ALLOWED_TYPES)[number])) {
      throw AppError.badRequest(`字段“${name}”的类型 ${declared} 不受支持`)
    }
    const inferredType = inferType(samples, declared)
    const type = formType(inferredType, declared)
    const warnings: string[] = []
    if (inferredType === 'unknown') warnings.push('未找到样例值，按文本字段创建')
    columns.push({
      sourceColumn: name,
      sampleValues: samples,
      targetFieldKey: fieldKey(name, index),
      inferredType,
      warnings,
    })
    const options = (type === 'single_select' || type === 'multi_select')
      ? [...new Set(samples)].map((value) => ({ label: value, value }))
      : undefined
    mainFields.push({
      id: `excel_field_${index + 1}`,
      key: fieldKey(name, index),
      name,
      type,
      required: false,
      strategy: 'optional',
      sort: mainFields.length + 1,
      options,
      isCore: false,
      editableByLocal: true,
    })
  }
  if (!mainFields.length) throw AppError.badRequest('Excel 未产生任何可用字段')

  return {
    sheetName: worksheet.name,
    columns,
    sampleRows,
    inferredSchema: { mainFields, subForms: [], conditionRules: [] },
    warnings: [
      ...(hasTypeRow ? [] : ['第二行不是 type: 类型行，已根据样例行自动推断']),
      ...(worksheet.rowCount <= sampleStart ? ['Excel 没有样例数据，字段统一按文本创建'] : []),
      `文件 ${basename(originalName)} 只读取第一个非空工作表`,
    ],
  }
}

export function saveSourceFile(buffer: Buffer, filename: string): string {
  const safeName = basename(filename).replace(/[^A-Za-z0-9._\-\u4e00-\u9fff]/g, '_')
  const dir = resolve(process.cwd(), 'data', 'imports')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${Date.now()}_${safeName}`)
  writeFileSync(path, buffer)
  return path
}

export async function readSourceFile(path: string) {
  return readFileSync(path)
}
