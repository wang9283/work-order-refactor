import type { ScopeRef } from '../../packages/contracts/src'
import { one } from '../db/database'

export function baseScope(baseId: string): ScopeRef {
  return { type: 'base', id: baseId }
}

export function workAreaScope(workAreaId: string): ScopeRef {
  const area = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [workAreaId])
  if (!area) throw new Error(`Work area not found: ${workAreaId}`)
  return { type: 'work_area', id: workAreaId }
}

export function companyScope(companyId: string): ScopeRef {
  return { type: 'company', id: companyId }
}

export function groupScope(): ScopeRef {
  return { type: 'group', id: 'group' }
}
