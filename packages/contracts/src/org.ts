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
  status: ActiveStatus
}

export interface WorkArea extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
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

export interface Crew extends AuditFields {
  id: Id
  code: string
  name: string
  baseId: Id
  workAreaId: Id
  leaderPersonId: Id | null
  status: ActiveStatus
}

export interface CrewMembership extends AuditFields {
  id: Id
  crewId: Id
  personId: Id
  role: CrewMemberRole
  validFrom: string
  validTo: string | null
}

export interface Qualification extends AuditFields {
  id: Id
  code: string
  name: string
  description: string
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
  status: ActiveStatus
  qualifications: Array<PersonQualification & { qualificationName: string; qualificationCode: string }>
}

export type SecondmentStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export interface Secondment extends AuditFields {
  id: Id
  personId: Id
  fromCompanyId: Id
  fromBaseId: Id
  toCompanyId: Id
  toBaseId: Id
  startDate: string
  endDate: string
  purpose: string
  status: SecondmentStatus
  approvedBy: Id | null
}

export interface OrgReferenceData {
  companies: Company[]
  bases: ProductionBase[]
  workAreas: WorkArea[]
  productionLines: ProductionLine[]
  crews: Crew[]
  qualifications: Qualification[]
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

export const workAreaSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  baseId: z.string().min(1),
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
  workAreaId: z.string().min(1),
  leaderPersonId: z.string().nullable().default(null),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const crewMembershipSchema = z.object({
  crewId: z.string().min(1),
  personId: z.string().min(1),
  role: z.enum(['leader', 'operator', 'support']).default('operator'),
  validFrom: z.string().min(10),
  validTo: z.string().min(10).nullable().default(null),
  revision: z.number().int().nonnegative().optional(),
})

export const personSchema = z.object({
  employeeCode: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().max(30).default(''),
  homeCompanyId: z.string().min(1),
  homeBaseId: z.string().min(1),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().nonnegative().optional(),
})

export const secondmentSchema = z.object({
  personId: z.string().min(1),
  fromCompanyId: z.string().min(1),
  fromBaseId: z.string().min(1),
  toCompanyId: z.string().min(1),
  toBaseId: z.string().min(1),
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  purpose: z.string().trim().max(240).default(''),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).default('planned'),
  approvedBy: z.string().nullable().default(null),
  revision: z.number().int().nonnegative().optional(),
}).refine((value) => value.startDate <= value.endDate, {
  message: '借调开始日期不能晚于结束日期',
  path: ['endDate'],
})
