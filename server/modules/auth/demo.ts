import type {
  DemoAuthOptions,
  DemoBaseOption,
  DemoLoginInput,
  DemoIdentityId,
  DemoIdentityOption,
  DemoLoginResult,
  DemoSessionResult,
} from '../../../packages/contracts/src'
import {
  createSession,
  currentUser,
  deleteSession,
  resolveAuth,
  setSessionSelectedBase,
  type AuthContext,
} from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one } from '../../db/database'
import { authorizedDemoBases, requireDemoBase, selectDemoBase } from './bases'

interface IdentityDefinition {
  id: DemoIdentityId
  label: string
  description: string
  usernames: string[]
  defaultForAdmin?: boolean
  defaultForMobile?: boolean
}

const definitions: IdentityDefinition[] = [
  {
    id: 'group-admin',
    label: '总部管理员',
    description: '跨基地标准、组织、权限与审计',
    usernames: ['group.admin'],
  },
  {
    id: 'base-admin',
    label: '基地配置管理员',
    description: '维护授权基地的主数据与作业配置',
    usernames: ['qd.admin', 'dz.admin'],
  },
  {
    id: 'production-manager',
    label: '生产经理',
    description: '安排月排班、工单与工作量',
    usernames: ['ops.manager', 'qd.manager'],
    defaultForAdmin: true,
  },
  {
    id: 'crew-leader',
    label: '班组长',
    description: '处理本组当天调整与人员分配',
    usernames: ['ops.leader'],
  },
  {
    id: 'employee',
    label: '员工',
    description: '查看本人作业并确认工作量',
    usernames: ['ops.worker', 'executor.demo'],
    defaultForMobile: true,
  },
  {
    id: 'sanitation-worker',
    label: '洗消工',
    description: '执行车辆与厂区洗消，确认本人工作量',
    usernames: ['ops.wash'],
  },
  {
    id: 'payroll',
    label: '基地核算员',
    description: '核对工作量和核算状态',
    usernames: ['qd.payroll'],
  },
]

interface DemoAccountRow {
  id: string
  username: string
  display_name: string
  status: string
  role_name: string | null
}

function enabled(): boolean {
  const configured = process.env.DEMO_AUTH?.trim().toLowerCase()
  if (configured) return configured === 'true'
  return process.env.NODE_ENV !== 'production'
}

function availableAccount(usernames: string[]): DemoAccountRow | undefined {
  if (!usernames.length) return undefined
  return all<DemoAccountRow>(
    `SELECT a.id, a.username, a.display_name, a.status, MIN(r.name) AS role_name
     FROM accounts a
     LEFT JOIN role_assignments ra ON ra.account_id = a.id
     LEFT JOIN roles r ON r.id = ra.role_id
     WHERE a.username IN (${usernames.map(() => '?').join(',')})
       AND a.status = 'active'
     GROUP BY a.id, a.username, a.display_name, a.status`,
    usernames,
  ).sort((left, right) => usernames.indexOf(left.username) - usernames.indexOf(right.username))[0]
}

function option(definition: IdentityDefinition): DemoIdentityOption {
  const account = availableAccount(definition.usernames)
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    username: account?.username ?? definition.usernames[0] ?? '',
    accountId: account?.id ?? null,
    displayName: account?.display_name ?? definition.label,
    roleName: account?.role_name ?? definition.label,
    available: Boolean(account),
    unavailableReason: account ? null : '当前演示数据中缺少可用的账号或人员关系',
    defaultForAdmin: Boolean(definition.defaultForAdmin),
    defaultForMobile: Boolean(definition.defaultForMobile),
  }
}

function definitionFor(identityId: DemoIdentityId): IdentityDefinition {
  const definition = definitions.find((candidate) => candidate.id === identityId)
  if (!definition) throw AppError.badRequest('未知演示身份')
  return definition
}

function scopeResult(auth: AuthContext, identity: DemoIdentityOption): DemoSessionResult {
  const bases = authorizedDemoBases(auth)
  const activeBase = bases.find((base) => base.id === auth.selectedBaseId) ?? bases[0]
  if (!activeBase) throw AppError.forbidden('当前演示身份没有可用的授权生产基地')
  return {
    identity,
    user: currentUser(auth),
    bases,
    activeBase,
  }
}

export function demoAuthOptions(): DemoAuthOptions {
  if (!enabled()) return { enabled: false, identities: [] }
  return { enabled: true, identities: definitions.map(option) }
}

export function demoLogin(input: DemoLoginInput): DemoLoginResult {
  if (!enabled()) throw AppError.forbidden('免登录演示入口未开启')
  const definition = definitionFor(input.identityId)
  const identity = option(definition)
  if (!identity.accountId || !identity.available) {
    throw AppError.badRequest(identity.unavailableReason || '演示身份不可用')
  }
  const session = createSession(identity.accountId, 24, { demoIdentityId: identity.id })
  const auth = resolveAuth(session.token)
  if (!auth) throw AppError.unauthorized()
  const activeBase = selectDemoBase(auth, input.baseId)
  if (!activeBase) {
    deleteSession(session.token)
    throw AppError.forbidden('当前演示身份没有可用的授权生产基地')
  }
  setSessionSelectedBase(auth.tokenHash, activeBase.id)
  const scopedAuth = { ...auth, selectedBaseId: activeBase.id }
  return { token: session.token, expiresAt: session.expiresAt, ...scopeResult(scopedAuth, identity) }
}

export function demoSession(auth: AuthContext): DemoSessionResult {
  if (!enabled()) throw AppError.forbidden('免登录演示入口未开启')
  if (!auth.demoIdentityId) throw AppError.forbidden('当前会话不是演示身份')
  const identity = option(definitionFor(auth.demoIdentityId))
  const bases = authorizedDemoBases(auth)
  const activeBase = bases.find((base) => base.id === auth.selectedBaseId) ?? bases[0]
  if (!activeBase) throw AppError.forbidden('当前演示身份没有可用的授权生产基地')
  if (activeBase.id !== auth.selectedBaseId) setSessionSelectedBase(auth.tokenHash, activeBase.id)
  return scopeResult({ ...auth, selectedBaseId: activeBase.id }, identity)
}

export function demoBaseSwitch(auth: AuthContext, baseId: string): DemoSessionResult {
  if (!enabled()) throw AppError.forbidden('免登录演示入口未开启')
  if (!auth.demoIdentityId) throw AppError.forbidden('当前会话不是演示身份')
  const target: DemoBaseOption = requireDemoBase(auth, baseId)
  setSessionSelectedBase(auth.tokenHash, target.id)
  return scopeResult({ ...auth, selectedBaseId: target.id }, option(definitionFor(auth.demoIdentityId)))
}
