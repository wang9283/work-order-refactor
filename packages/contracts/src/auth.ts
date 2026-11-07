import { z } from 'zod'
import type { ActiveStatus, Id, ScopeRef } from './common'

export const capabilities = [
  'dashboard.view',
  'org.view',
  'org.manage',
  'person.view',
  'person.manage',
  'crew.view',
  'crew.manage',
  'qualification.manage',
  'secondment.view',
  'secondment.manage',
  'access.manage',
  'form.view',
  'form.manage',
  'form.publish',
  'ticket_type.view',
  'ticket_type.manage',
  'business_catalog.manage',
  'work_profile.view',
  'work_profile.manage',
  'excel_import.manage',
  'ticket.view',
  'ticket.create',
  'ticket.assign',
  'ticket.execute',
  'ticket.review',
  'price.view',
  'price.manage',
  'payroll.view',
  'payroll.close',
  'audit.view',
] as const

export type Capability = (typeof capabilities)[number]

export interface CapabilityGrant extends ScopeRef {
  capability: Capability
}

export interface RoleSummary {
  id: Id
  code: string
  name: string
  builtIn: boolean
}

export interface RoleAssignmentSummary {
  assignmentId: Id
  role: RoleSummary
  scope: ScopeRef
  validFrom: string | null
  validTo: string | null
}

export interface CurrentUser {
  accountId: Id
  username: string
  displayName: string
  personId: Id | null
  status: ActiveStatus
  grants: CapabilityGrant[]
  assignments: RoleAssignmentSummary[]
}

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(6).max(200),
})

export type LoginInput = z.infer<typeof loginSchema>

export interface LoginResult {
  token: string
  expiresAt: string
  user: CurrentUser
}

export const demoIdentityIds = [
  'group-admin',
  'base-admin',
  'production-manager',
  'crew-leader',
  'employee',
  'sanitation-worker',
  'payroll',
] as const

export type DemoIdentityId = (typeof demoIdentityIds)[number]

export interface DemoIdentityOption {
  id: DemoIdentityId
  label: string
  description: string
  username: string
  accountId: Id | null
  displayName: string
  roleName: string
  available: boolean
  unavailableReason: string | null
  defaultForAdmin: boolean
  defaultForMobile: boolean
}

export interface DemoAuthOptions {
  enabled: boolean
  identities: DemoIdentityOption[]
}

export interface DemoBaseOption {
  id: Id
  code: string
  name: string
  companyId: Id
}

/** A selectable work organization from the org tree maintained in Org Management. */
export interface DemoOrgOption {
  id: Id
  code: string
  name: string
  parentId: Id | null
  factoryId: Id
  baseId: Id
  baseName: string
  path: string[]
}

export const demoLoginSchema = z.object({
  identityId: z.enum(demoIdentityIds),
  baseId: z.string().trim().min(1).optional(),
  orgId: z.string().trim().min(1).optional(),
})

export type DemoLoginInput = z.infer<typeof demoLoginSchema>

export interface DemoLoginResult extends LoginResult {
  identity: DemoIdentityOption
  orgs: DemoOrgOption[]
  activeOrg: DemoOrgOption
  bases: DemoBaseOption[]
  activeBase: DemoBaseOption
}

export interface DemoSessionResult {
  identity: DemoIdentityOption
  user: CurrentUser
  orgs: DemoOrgOption[]
  activeOrg: DemoOrgOption
  bases: DemoBaseOption[]
  activeBase: DemoBaseOption
}

export const demoBaseSwitchSchema = z.object({
  baseId: z.string().trim().min(1),
})

export type DemoBaseSwitchInput = z.infer<typeof demoBaseSwitchSchema>

export const demoOrgSwitchSchema = z.object({
  orgId: z.string().trim().min(1),
})

export type DemoOrgSwitchInput = z.infer<typeof demoOrgSwitchSchema>

export interface PermissionCheck {
  capability: Capability
  scope: ScopeRef
}
