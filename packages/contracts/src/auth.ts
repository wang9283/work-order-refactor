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

export interface PermissionCheck {
  capability: Capability
  scope: ScopeRef
}
