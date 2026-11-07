import { AppError } from './errors'
import { one } from '../db/database'

export interface BaseScopedAuth {
  demoIdentityId?: string | null
  selectedBaseId?: string | null
  selectedOrgNodeId?: string | null
}

/**
 * Returns the hard base filter for demo sessions. Legacy authenticated
 * sessions return null and keep their existing authorization behavior.
 */
export function scopedBaseId(auth: BaseScopedAuth): string | null {
  if (!auth.demoIdentityId) return null
  if (!auth.selectedBaseId) throw AppError.unauthorized('演示会话未选择生产基地，请重新选择身份')
  return auth.selectedBaseId
}

export function withinScopedBase(auth: BaseScopedAuth, baseId: string): boolean {
  const selected = scopedBaseId(auth)
  return selected === null || selected === baseId
}

export function requireScopedBase(auth: BaseScopedAuth, baseId: string): void {
  if (!withinScopedBase(auth, baseId)) {
    throw AppError.forbidden('该资源不属于当前所选生产基地')
  }
}

/** Factory of the selected work organization; null for legacy non-demo sessions. */
export function scopedFactoryId(auth: BaseScopedAuth): string | null {
  if (!auth.demoIdentityId) return null
  if (!auth.selectedOrgNodeId) return null
  const row = one<{ factory_id: string | null }>('SELECT factory_id FROM org_nodes WHERE id = ?', [auth.selectedOrgNodeId])
  return row?.factory_id ?? null
}

export function withinScopedFactory(auth: BaseScopedAuth, factoryId: string | null): boolean {
  const selected = scopedFactoryId(auth)
  return selected === null || selected === factoryId
}

export function requireScopedFactory(auth: BaseScopedAuth, factoryId: string | null): void {
  if (!withinScopedFactory(auth, factoryId)) {
    throw AppError.forbidden('该资源不属于当前所选作业组织')
  }
}
