import { useCallback, useEffect, useState } from 'react'
import { Button, Card, NavBar, TabBar, Toast } from 'antd-mobile'
import { CalendarOutline, CheckCircleOutline, FileOutline, UserOutline } from 'antd-mobile-icons'
import type { OperationsContext } from '@contracts/operations'
import type { DemoIdentityId } from '@contracts/index'
import { AuthProvider, useAuth } from '@next/shared/auth'
import { errorMessage } from '@next/shared/api'
import { operationsApi } from '@next/shared/operations-api'
import { WorkPage } from './WorkPage'
import { SchedulePage } from './SchedulePage'
import { WorkloadPage } from './WorkloadPage'
import { Empty, ErrorNotice } from './components'

type MobileTab = 'work' | 'schedule' | 'workload' | 'me'
const tabs = {
  work: { title: '作业', description: '查看本人作业，临时工作随手记录。' },
  schedule: { title: '日程', description: '看清今天的班次、岗位和作业安排。' },
  workload: { title: '工作量', description: '按日核对已完成工单，确认本人分配量。' },
  me: { title: '我的', description: '账号信息与个人作业身份。' },
}

function MobileShell() {
  const {
    user,
    identities,
    activeIdentity,
    orgs,
    activeOrg,
    switchIdentity,
    switchOrg,
    contextVersion,
    error: contextError,
    refresh: refreshAuth,
  } = useAuth()
  const [tab, setTab] = useState<MobileTab>('work')
  const [context, setContext] = useState<OperationsContext | null>(null)
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const next = await operationsApi.context(); setContext(next); setDate(current => current || next.today) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [contextVersion, user?.accountId])
  useEffect(() => { void load() }, [load])
  const changed = () => setVersion(current => current + 1)
  const me = context?.people.find(person => person.id === context.personId)
  return <div className="mobile-frame mobile-app-frame">
    <NavBar
      back={null}
      className="mobile-nav"
      right={<div className="mobile-context-controls">
        <label className="mobile-context-switch">
          <span>组织</span>
          <select
            aria-label="切换作业组织"
            value={activeOrg?.id}
            onChange={(event) => {
              void switchOrg(event.target.value).catch((reason) => {
                Toast.show({ icon: 'fail', content: errorMessage(reason) })
              })
            }}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.path.join(' / ')}
              </option>
            ))}
          </select>
        </label>
        <label className="mobile-context-switch">
          <span>身份</span>
          <select
            aria-label="切换角色身份"
            value={activeIdentity?.id}
            onChange={(event) => {
              void switchIdentity(event.target.value as DemoIdentityId)
            }}
          >
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id} disabled={!identity.available}>
                {identity.label}
              </option>
            ))}
          </select>
        </label>
      </div>}
    >
      <img src="/logo.svg" alt="东方希望" className="nav-logo" />
    </NavBar>
    <header className="mobile-page-heading"><div><h1>{tabs[tab].title}</h1><p>{tabs[tab].description}</p></div><span className="mobile-greeting">{user?.displayName?.slice(0, 1)}</span></header>
    {contextError && <ErrorNotice message={contextError} retry={() => void refreshAuth()} />}
    {loading && <Empty>正在读取作业信息…</Empty>}
    {error && <ErrorNotice message={error} retry={() => void load()} />}
    {!loading && context && !error && <>
      {tab === 'work' && <WorkPage context={context} date={date} onDateChange={setDate} version={version} onChange={changed} />}
      {tab === 'schedule' && <SchedulePage context={context} date={date} onDateChange={setDate} version={version} onChange={changed} />}
      {tab === 'workload' && <WorkloadPage context={context} date={date} onDateChange={setDate} version={version} onChange={changed} />}
      {tab === 'me' && <div className="mobile-card-list"><Card><div className="mobile-profile"><span>{user?.displayName?.slice(0, 1)}</span><div><h2>{user?.displayName}</h2><p>{me?.employeeCode || '未关联员工编号'}</p></div></div><div className="mobile-detail-field"><span>作业组织</span><b>{activeOrg?.path.join(' / ') || '未选择'}</b></div><div className="mobile-detail-field"><span>演示身份</span><b>{activeIdentity?.label || '未分配'}</b></div><div className="mobile-detail-field"><span>所属班组</span><b>{context.crews.filter(crew => me?.crewIds.includes(crew.id)).map(crew => crew.name).join('、') || '未分配'}</b></div><div className="mobile-detail-field"><span>当前角色</span><b>{user?.assignments.map(assignment => assignment.role.name).join('、') || '未分配'}</b></div>{context.crews.some(crew => crew.canManage) && <div className="mobile-detail-field"><span>可管理班组</span><b>{context.crews.filter(crew => crew.canManage).map(crew => crew.name).join('、')}</b></div>}</Card><p className="mobile-profile-note">计件工作量以最新分配记录为准。页面预计单价仅供参考，实际工资由薪酬系统核算。</p></div>}
    </>}
    <TabBar activeKey={tab} onChange={key => setTab(key as MobileTab)} className="mobile-tabbar">
      <TabBar.Item key="work" icon={<FileOutline />} title="作业" />
      <TabBar.Item key="schedule" icon={<CalendarOutline />} title="日程" />
      <TabBar.Item key="workload" icon={<CheckCircleOutline />} title="工作量" />
      <TabBar.Item key="me" icon={<UserOutline />} title="我的" />
    </TabBar>
  </div>
}

function Gate() {
  const { user, loading, switching, error, refresh } = useAuth()
  if (loading || switching) return <div className="mobile-boot">正在连接作业服务</div>
  if (!user) return <main className="mobile-context-error">
    <img src="/logo.svg" alt="东方希望" />
    <h1>暂时无法进入</h1>
    <p>{error || '没有可用的演示身份'}</p>
    <Button color="primary" onClick={() => void refresh()}>重新连接</Button>
  </main>
  return <MobileShell />
}

export default function App() { return <AuthProvider surface="mobile"><Gate /></AuthProvider> }
