import { api } from './api'
import type {
  OperationsContext, OperationsQuery, OperationsRoster, SaveRosterInput, WorkloadResult, OperationsTicket,
  AdjustAssignmentsInput, OperationsFeedback, SelfCreateInput, CompleteSelfInput, DemoSyncInput, WorkloadExport,
  AssignmentRule, RosterCandidate, CreateSanitationInput, AddSanitationEvidenceInput, SanitationAreaInput, CompleteSanitationInput,
  SanitationSummary,
} from '@contracts/operations'

function query(input: OperationsQuery = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value) params.set(key, value)
  return params.size ? `?${params}` : ''
}
export const operationsApi = {
  context: () => api.get<OperationsContext>('/operations/context'),
  rosters: (input: OperationsQuery = {}) => api.get<OperationsRoster[]>(`/operations/rosters${query(input)}`),
  saveRosters: (input: SaveRosterInput) => api.put<OperationsRoster[]>('/operations/rosters', input),
  workloads: (input: OperationsQuery = {}) => api.get<WorkloadResult>(`/operations/workloads${query(input)}`),
  ticket: (id: string) => api.get<OperationsTicket>(`/operations/tickets/${encodeURIComponent(id)}`),
  adjustAssignments: (ticketId: string, workItemId: string, input: AdjustAssignmentsInput) =>
    api.put<OperationsTicket>(`/operations/tickets/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(workItemId)}/assignments`, input),
  confirm: (ticketIds: string[]) => api.post<{ confirmed: number }>('/operations/confirmations', { ticketIds }),
  feedback: (input: OperationsQuery = {}) => api.get<OperationsFeedback[]>(`/operations/feedback${query(input)}`),
  createFeedback: (ticketId: string, message: string) => api.post<OperationsFeedback>('/operations/feedback', { ticketId, message }),
  resolveFeedback: (id: string, revision: number, response: string) =>
    api.put<OperationsFeedback>(`/operations/feedback/${encodeURIComponent(id)}`, { revision, response }),
  selfCreate: (input: SelfCreateInput) => api.post<OperationsTicket>('/operations/self-create', input),
  completeSelf: (id: string, input: CompleteSelfInput) => api.post<OperationsTicket>(`/operations/tickets/${encodeURIComponent(id)}/complete`, input),
  demoSync: (input: DemoSyncInput) => api.post<{ ticket: OperationsTicket; duplicate: boolean }>('/operations/demo-sync', input),
  exportWorkloads: (input: OperationsQuery = {}) => api.get<WorkloadExport>(`/operations/export${query(input)}`),
  assignmentRules: () => api.get<AssignmentRule[]>('/operations/assignment-rules'),
  saveAssignmentRule: (input: { siteId: string; ticketTypeId: string; crewId: string; revision: number }) => api.put<AssignmentRule>('/operations/assignment-rules', input),
  rosterCandidates: (crewId: string, workDate: string) => api.get<RosterCandidate[]>(`/operations/roster-candidates?crewId=${encodeURIComponent(crewId)}&workDate=${workDate}`),
  sanitationSummary: (input: OperationsQuery = {}) => api.get<SanitationSummary[]>(`/operations/sanitation-summary${query(input)}`),
  saveShift: (input: { id?: string; siteId?: string; code?: string; name: string; startTime: string; endTime: string; status: 'active' | 'inactive'; revision: number }) => {
    if (!input.id) return api.post('/operations/shifts', input)
    return api.put(`/operations/shifts/${input.id}`, {
      name: input.name, startTime: input.startTime, endTime: input.endTime, status: input.status, revision: input.revision,
    })
  },
  createSanitation: (input: CreateSanitationInput) => api.post<OperationsTicket>('/operations/sanitation', input),
  demoAssets: (kind: 'vehicle' | 'facility') => api.get<Array<{ id: string; name: string; url: string }>>(`/operations/demo-assets?kind=${kind}`),
  startSanitation: (id: string, revision: number) => api.post<OperationsTicket>(`/operations/tickets/${id}/start-sanitation`, { revision }),
  addSanitationEvidence: (id: string, input: AddSanitationEvidenceInput) => api.post<OperationsTicket>(`/operations/tickets/${id}/evidence`, input),
  startSanitationArea: (id: string, input: SanitationAreaInput) => api.post<OperationsTicket>(`/operations/tickets/${id}/areas/${input.areaKey}/start`, { revision: input.revision }),
  completeSanitationArea: (id: string, input: SanitationAreaInput) => api.post<OperationsTicket>(`/operations/tickets/${id}/areas/${input.areaKey}/complete`, { revision: input.revision }),
  completeSanitation: (id: string, input: CompleteSanitationInput) => api.post<OperationsTicket>(`/operations/tickets/${id}/complete-sanitation`, input),
}
