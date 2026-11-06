import { z } from 'zod'
import type { ActiveStatus, AuditFields, Id } from './common'

export interface Company extends AuditFields {
  id: Id
  code: string
  name: string
  shortName: string
  isGroup: boolean
  payrollEnabled: boolean
  status: ActiveStatus
}

export interface ProductionBase extends AuditFields {
  id: Id
  code: string
  name: string
  companyId: Id
  address: string
  siteConfirmed: boolean
  status: ActiveStatus
}

export type FactoryType = 'direct_mill' | 'feed_mill' | 'other'

export interface ManagementGroup {
  id: Id
  code: string
  name: string
  status: ActiveStatus
  revision: number
}

export const managementGroupSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
})
export const managementGroupUpdateSchema = z.object({
  code: z.string().trim().min(2).max(30).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  revision: z.number().int().nonnegative(),
})

export interface Factory extends AuditFields {
  id: Id
  code: string
  name: string
  companyId: Id
  baseId: Id
  managementGroupId: Id | null
  factoryType: FactoryType
  managerPersonId: Id | null
  address: string
  sortOrder: number
  status: ActiveStatus
}

export interface WorkArea extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
  factoryId: Id | null
  parentId: Id | null
  managerPersonId: Id | null
  status: ActiveStatus
}

export interface ProductionLine extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
  workAreaId: Id
  status: ActiveStatus
}

export type CrewMemberRole = 'leader' | 'operator' | 'support'

/** Current crew assignment of a person, derived from active membership dates. */
export interface PersonCrewSummary {
  crewId: Id
  crewName: string
  role: CrewMemberRole
  validFrom: string
  validTo: string | null
}

/** Every membership relation of a person, including future and ended ones. */
export interface PersonCrewHistory extends PersonCrewSummary {
  membershipId: Id
  relation: 'current' | 'future' | 'ended'
}

export interface Crew extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
  workAreaId: Id | null
  factoryId: Id | null
  leaderPersonId: Id | null
  status: ActiveStatus
  // A crew can appoint more than one leader; the list shows all current leaders.
  leaderPersonIds: Id[]
  // Display labels for the same leaders, so readers without people-list access still see names.
  leaderNames: string[]
  memberCount: number
}

export interface CrewMembership extends AuditFields {
  id: Id
  crewId: Id
  personId: Id
  // Populated by the crew member read model so the crew page does not need the full people list.
  personName?: string
  employeeCode?: string
  role: CrewMemberRole
  validFrom: string
  validTo: string | null
}

export interface CrewScope {
  id: Id
  crewId: Id
  workAreaId: Id | null
  productionLineId: Id | null
}

export interface Qualification extends AuditFields {
  id: Id
  code: string
  name: string
  description: string
  status: ActiveStatus
}

export interface ShiftTemplate extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
  startTime: string
  endTime: string
  crossDay: boolean
}

export interface HandoverShiftProfile extends AuditFields {
  id: Id
  name: string
  factoryId: Id
  siteId: Id
  shiftTemplateId: Id
  crewIds: Id[]
  assignmentMode: 'roster_first' | 'manual'
  handoverRequired: boolean
  earlyStartMinutes: number
  lateEndMinutes: number
  instruction: string
  status: ActiveStatus
}

export interface PersonQualification extends AuditFields {
  id: Id
  personId: Id
  qualificationId: Id
  validFrom: string
  validTo: string | null
  certificateNo: string
}

export interface Person extends AuditFields {
  id: Id
  employeeCode: string
  name: string
  mobile: string
  homeCompanyId: Id
  homeBaseId: Id
  factoryId: Id | null
  status: ActiveStatus
  qualifications: Array<PersonQualification & { qualificationName: string; qualificationCode: string }>
  crew: PersonCrewSummary | null
}

export type SecondmentStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export interface Secondment extends AuditFields {
  id: Id
  personId: Id
  fromCompanyId: Id
  fromBaseId: Id
  toCompanyId: Id
  toBaseId: Id
  toFactoryId: Id | null
  startDate: string
  endDate: string
  purpose: string
  status: SecondmentStatus
  approvedBy: Id | null
}

export interface OrgReferenceData {
  companies: Company[]
  bases: ProductionBase[]
  factories: Factory[]
  managementGroups: ManagementGroup[]
  handoverShiftProfiles: HandoverShiftProfile[]
  workAreas: WorkArea[]
  productionLines: ProductionLine[]
  crews: Crew[]
  qualifications: Qualification[]
  shiftTemplates: ShiftTemplate[]
}

export const companySchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  shortName: z.string().trim().max(40).default(''),
  isGroup: z.boolean().default(false),
  payrollEnabled: z.boolean().default(true),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const productionBaseSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  companyId: z.string().min(1),
  address: z.string().trim().max(240).default(''),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const factorySchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  companyId: z.string().min(1),
  baseId: z.string().min(1),
  managementGroupId: z.string().nullable().default(null),
  factoryType: z.enum(['direct_mill', 'feed_mill', 'other']).default('feed_mill'),
  managerPersonId: z.string().nullable().default(null),
  address: z.string().trim().max(240).default(''),
  sortOrder: z.number().int().nonnegative().default(0),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const workAreaSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  baseId: z.string().min(1),
  factoryId: z.string().min(1),
  parentId: z.string().nullable().default(null),
  managerPersonId: z.string().nullable().default(null),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const productionLineSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  baseId: z.string().min(1),
  workAreaId: z.string().min(1),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const crewSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  baseId: z.string().min(1),
  workAreaId: z.string().nullable().default(null),
  factoryId: z.string().nullable().default(null),
  leaderPersonId: z.string().nullable().default(null),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const crewMembershipSchema = z.object({
  crewId: z.string().min(1),
  personId: z.string().min(1),
  role: z.enum(['leader', 'operator', 'support']).default('operator'),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable().default(null),
  revision: z.number().int().nonnegative().optional(),
})

export const personSchema = z.object({
  employeeCode: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().max(30).default(''),
  homeCompanyId: z.string().min(1),
  homeBaseId: z.string().min(1),
  factoryId: z.string().nullable().default(null),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const secondmentSchema = z.object({
  personId: z.string().min(1),
  fromCompanyId: z.string().min(1),
  fromBaseId: z.string().min(1),
  toCompanyId: z.string().min(1),
  toBaseId: z.string().min(1),
  toFactoryId: z.string().min(1),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  purpose: z.string().trim().max(240).default(''),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).default('planned'),
  approvedBy: z.string().nullable().default(null),
  revision: z.number().int().nonnegative().optional(),
}).refine((value) => value.startDate <= value.endDate, {
  message: '借调开始日期不能晚于结束日期',
  path: ['endDate'],
})

export const secondmentUpdateSchema = z.object({
  toFactoryId: z.string().min(1).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  purpose: z.string().trim().max(240).optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
  approvedBy: z.string().nullable().optional(),
  revision: z.number().int().nonnegative(),
})

export const companyUpdateSchema = companySchema.partial().extend({
  shortName: companySchema.shape.shortName.unwrap().optional(),
  isGroup: companySchema.shape.isGroup.unwrap().optional(),
  payrollEnabled: companySchema.shape.payrollEnabled.unwrap().optional(),
  status: companySchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const productionBaseUpdateSchema = productionBaseSchema.partial().extend({
  address: productionBaseSchema.shape.address.unwrap().optional(),
  status: productionBaseSchema.shape.status.unwrap().optional(),
  siteConfirmed: z.boolean().optional(),
  revision: z.number().int().nonnegative(),
})

export const factoryUpdateSchema = factorySchema.partial().extend({
  managementGroupId: z.string().nullable().optional(),
  factoryType: factorySchema.shape.factoryType.unwrap().optional(),
  managerPersonId: factorySchema.shape.managerPersonId.unwrap().optional(),
  address: factorySchema.shape.address.unwrap().optional(),
  sortOrder: factorySchema.shape.sortOrder.unwrap().optional(),
  status: factorySchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const workAreaUpdateSchema = workAreaSchema.partial().extend({
  parentId: workAreaSchema.shape.parentId.unwrap().optional(),
  managerPersonId: workAreaSchema.shape.managerPersonId.unwrap().optional(),
  status: workAreaSchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const productionLineUpdateSchema = productionLineSchema.partial().extend({
  status: productionLineSchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const crewUpdateSchema = crewSchema.partial().extend({
  workAreaId: crewSchema.shape.workAreaId.unwrap().optional(),
  factoryId: crewSchema.shape.factoryId.unwrap().optional(),
  leaderPersonId: crewSchema.shape.leaderPersonId.unwrap().optional(),
  status: crewSchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const personUpdateSchema = personSchema.partial().extend({
  mobile: personSchema.shape.mobile.unwrap().optional(),
  factoryId: personSchema.shape.factoryId.unwrap().optional(),
  status: personSchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const qualificationSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(240).default(''),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const qualificationUpdateSchema = qualificationSchema.partial().extend({
  description: qualificationSchema.shape.description.unwrap().optional(),
  status: qualificationSchema.shape.status.unwrap().optional(),
  revision: z.number().int().nonnegative(),
})

export const personQualificationsSchema = z.object({
  qualifications: z.array(z.object({
    qualificationId: z.string().min(1),
    validFrom: z.string().min(10),
    validTo: z.string().min(10).nullable().default(null),
    certificateNo: z.string().trim().max(80).default(''),
  })).max(50),
})

export const crewMemberEndSchema = z.object({
  endDate: z.iso.date(),
  revision: z.number().int().nonnegative(),
})

export const crewMembersBatchSchema = z.object({
  members: z.array(crewMembershipSchema.omit({ crewId: true, revision: true })).min(1).max(100),
})

export const crewMemberUpdateSchema = z.object({
  role: z.enum(['leader', 'operator', 'support']),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
  revision: z.number().int().nonnegative(),
})

export const crewScopesSchema = z.object({
  workAreaIds: z.array(z.string().min(1)).max(100),
  productionLineIds: z.array(z.string().min(1)).max(100),
  revision: z.number().int().nonnegative(),
})

export const revisionSchema = z.object({
  revision: z.coerce.number().int().nonnegative(),
})

export const accessAssignmentSchema = z.object({
  accountId: z.string().min(1),
  roleId: z.string().min(1),
  scope: z.object({
    type: z.enum(['group', 'company', 'base', 'factory', 'work_area']),
    id: z.string().min(1),
  }),
  validFrom: z.string().min(10).nullable().default(null),
  validTo: z.string().min(10).nullable().default(null),
})
