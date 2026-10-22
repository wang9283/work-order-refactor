import type { OrgReferenceData, ScopeRef } from '@contracts/index'

export function scopeOptions(reference: OrgReferenceData | null): Array<{ label: string; value: string; scope: ScopeRef }> {
  if (!reference) return []
  const group = reference.companies.find((company) => company.isGroup)
  return [
    ...(group ? [{ label: `集团 · ${group.name}`, value: 'group:group', scope: { type: 'group' as const, id: 'group' } }] : []),
    ...reference.companies.filter((company) => !company.isGroup).map((company) => ({
      label: `公司 · ${company.name}`,
      value: `company:${company.id}`,
      scope: { type: 'company' as const, id: company.id },
    })),
    ...reference.bases.map((base) => ({
      label: `基地 · ${base.name}`,
      value: `base:${base.id}`,
      scope: { type: 'base' as const, id: base.id },
    })),
    ...reference.workAreas.map((area) => ({
      label: `工区 · ${area.name}`,
      value: `work_area:${area.id}`,
      scope: { type: 'work_area' as const, id: area.id },
    })),
  ]
}
