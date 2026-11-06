import { AppError } from './errors'

export interface BaseScopedAuth {
  demoIdentityId?: string | null
  selectedBaseId?: string | null
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
