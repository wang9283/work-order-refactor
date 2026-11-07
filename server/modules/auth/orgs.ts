import type { DemoOrgOption } from '../../../packages/contracts/src'
import type { AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one } from '../../db/database'

interface OrgNodeRow {
  id: string
  parent_id: string | null
  code: string
  name: string
  factory_id: string | null
  pricing_site_id: string | null
  status: string
}

interface FactoryRow {
  id: string
  base_id: string
}

interface BaseRow {
  id: string
  name: string
}

function visibleFactoryIds(auth: AuthContext): Set<string> | null {
  if (auth.grants.some((grant) => grant.type === 'group')) return null
  const visible = new Set<string>()
  for (const grant of auth.grants) {
    if (grant.type === 'factory') {
      visible.add(grant.id)
    } else if (grant.type === 'base') {
      all<FactoryRow>('SELECT id, base_id FROM factories WHERE base_id = ?', [grant.id])
        .forEach((row) => visible.add(row.id))
    } else if (grant.type === 'company') {
      all<FactoryRow>(
        `SELECT f.id, f.base_id FROM factories f
          JOIN production_bases b ON b.id = f.base_id
         WHERE b.company_id = ?`,
        [grant.id],
      ).forEach((row) => visible.add(row.id))
    } else if (grant.type === 'work_area') {
      const row = one<{ factory_id: string | null }>('SELECT factory_id FROM work_areas WHERE id = ?', [grant.id])
      if (row?.factory_id) visible.add(row.factory_id)
    }
  }
  return visible
}

/** Work organizations selectable in the top bar: active org nodes with a factory, narrowed by grants. */
export function authorizedDemoOrgs(auth: AuthContext): DemoOrgOption[] {
  const nodes = all<OrgNodeRow>('SELECT * FROM org_nodes WHERE status = ? ORDER BY name, id', ['active'])
  const visible = visibleFactoryIds(auth)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pathOf = (node: OrgNodeRow): string[] => {
    const path: string[] = []
    let cursor: OrgNodeRow | undefined = node
    while (cursor) {
      path.unshift(cursor.name)
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined
    }
    return path
  }
  return nodes
    .filter((node) => node.factory_id !== null && node.pricing_site_id !== null)
    .filter((node) => visible === null || (node.factory_id !== null && visible.has(node.factory_id)))
    .map((node) => {
      const factory = one<FactoryRow>('SELECT id, base_id FROM factories WHERE id = ?', [node.factory_id as string])
      const base = factory ? one<BaseRow>('SELECT id, name FROM production_bases WHERE id = ?', [factory.base_id]) : undefined
      if (!factory || !base) return null
      return {
        id: node.id,
        code: node.code,
        name: node.name,
        parentId: node.parent_id,
        factoryId: factory.id,
        baseId: base.id,
        baseName: base.name,
        path: pathOf(node),
      } satisfies DemoOrgOption
    })
    .filter((option): option is DemoOrgOption => option !== null)
}

export function selectDemoOrg(auth: AuthContext, preferredOrgId?: string | null): DemoOrgOption | null {
  const orgs = authorizedDemoOrgs(auth)
  return orgs.find((org) => org.id === preferredOrgId) ?? orgs[0] ?? null
}

export function requireDemoOrg(auth: AuthContext, orgId: string): DemoOrgOption {
  const org = authorizedDemoOrgs(auth).find((candidate) => candidate.id === orgId)
  if (!org) throw AppError.forbidden('当前身份无权访问所选作业组织')
  return org
}
