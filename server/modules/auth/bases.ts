import type { DemoBaseOption } from '../../../packages/contracts/src'
import { AppError } from '../../core/errors'
import type { AuthContext } from '../../core/auth'
import { all, one } from '../../db/database'

interface IdRow {
  id: string
}

/**
 * Lists enabled bases covered by at least one effective grant. A base choice
 * narrows every subsequent operation; it never manufactures a new permission.
 */
export function authorizedDemoBases(auth: AuthContext): DemoBaseOption[] {
  const visible = auth.grants.some((grant) => grant.type === 'group')
    ? null
    : new Set<string>()

  if (visible) {
    for (const grant of auth.grants) {
      if (grant.type === 'company') {
        all<IdRow>('SELECT id FROM production_bases WHERE company_id = ?', [grant.id])
          .forEach((row) => visible.add(row.id))
      } else if (grant.type === 'base') {
        visible.add(grant.id)
      } else if (grant.type === 'factory') {
        const row = one<{ base_id: string }>('SELECT base_id FROM factories WHERE id = ?', [grant.id])
        if (row) visible.add(row.base_id)
      } else if (grant.type === 'work_area') {
        const row = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [grant.id])
        if (row) visible.add(row.base_id)
      }
    }
  }

  return all<DemoBaseOption>(
    `SELECT id, code, name, company_id AS companyId
       FROM production_bases
      WHERE status = 'active'
      ORDER BY name, id`,
  ).filter((base) => visible === null || visible.has(base.id))
}

export function selectDemoBase(
  auth: AuthContext,
  preferredBaseId?: string | null,
): DemoBaseOption | null {
  const bases = authorizedDemoBases(auth)
  return bases.find((base) => base.id === preferredBaseId) ?? bases[0] ?? null
}

export function requireDemoBase(auth: AuthContext, baseId: string): DemoBaseOption {
  const base = authorizedDemoBases(auth).find((candidate) => candidate.id === baseId)
  if (!base) throw AppError.forbidden('当前身份无权访问所选生产基地')
  return base
}
