import type {
  FormVersionSchema,
  ScopeRef,
  WorkProfile,
} from '../../../packages/contracts/src'

export interface ResolvedTicketTypeVersion {
  ticketTypeId: string
  ticketTypeCode: string
  ticketTypeName: string
  ownerType: 'group' | 'company'
  ownerId: string
  ticketTypeVersionId: string
  ticketTypeVersionNo: number
  formVersionId: string
  formVersionNo: number
  formSchema: FormVersionSchema
  workProfiles: WorkProfile[]
  snapshot: Record<string, unknown>
}

export interface TicketContextPort {
  resolveTicketTypeVersion(ticketTypeId: string): ResolvedTicketTypeVersion
  findWorkProfile(
    resolved: ResolvedTicketTypeVersion,
    input: {
      siteId: string
      factoryId: string | null
      workAreaId: string | null
      productionLineId: string | null
    },
  ): WorkProfile | null
}

export interface CandidateResolution {
  isCrewMember?: boolean
  person: {
    id: string
    employeeCode: string
    name: string
    homeCompanyId: string
    homeBaseId: string
  }
  crewId: string | null
  crewName: string
  source: 'roster' | 'secondment' | 'manual'
  role: 'lead' | 'member'
}

export interface RosterContextPort {
  findEligibleCandidates(input: {
    siteId: string
    factoryId: string | null
    workAreaId: string | null
    productionLineId: string | null
    crewId: string | null
    eventTime: string
    workDate: string
  }): CandidateResolution[]
  validateAssignment(input: {
    personId: string
    siteId: string
    factoryId: string | null
    crewId: string | null
    eventTime: string
    workDate: string
  }): CandidateResolution
}

export interface PriceResolutionPort {
  findPublishedPrice(input: {
    ticketTypeId: string
    siteId: string
    eventTime: string
  }): { id: string; versionNo: number; unitPriceMicros: number; unit: string; effectiveFrom: string; effectiveTo: string | null } | null
}

export interface PayrollCompanyPort {
  resolvePayrollCompany(input: {
    personId: string
    workMonth: string
    confirmedCompanyId?: string | null
  }): string | null
}

export interface CapabilityPort {
  check(capability: string, scope: ScopeRef): void
}
