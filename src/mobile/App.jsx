import React, { useEffect, useState } from 'react'
import { NavBar, TabBar, Space, Button } from 'antd-mobile'
import { AppOutline, UnorderedListOutline, UserOutline } from 'antd-mobile-icons'
import { loadConfig, loadCurrentOrg, loadCurrentRole, saveCurrentRole } from '@shared/store'
import { ROLE_LABELS } from '@shared/roles'
import TaskList from './pages/TaskList'
import TaskDetail from './pages/TaskDetail'
import DaySchedule from './pages/DaySchedule'
import Contribution from './pages/Contribution'
import IncomeCheck from './pages/IncomeCheck'
import MobileHome from './pages/MobileHome'
import Messages from './pages/Messages'
import Mine from './pages/Mine'

// 内部状态 → 用户分组：对执行人隐藏「待数据 / 已超时」等概念，仅真发生时动态露出
const STATUS_MAP = { pending: 'todo', inProgress: 'doing', completed: 'done', waitingData: 'waiting', timeout: 'timeout' }
const MINE_TITLES = { schedule: '日排班', contribution: '贡献调节', income: '收入核对' }

export default function App() {
  const [tab, setTab] = useState('home')
  const [taskStatus, setTaskStatus] = useState('all')
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [showMessages, setShowMessages] = useState(false)
  const [mineView, setMineView] = useState('menu')
  const [role, setRole] = useState(() => loadCurrentRole(loadCurrentOrg()))
  const config = loadConfig()
  const orgId = loadCurrentOrg()
  const currentOrg = config.orgs.find((o) => o.id === orgId)

  // PC 端切换组织/角色后，App 侧同步刷新视角
  useEffect(() => {
    setRole(loadCurrentRole(orgId))
    setMineView('menu')
  }, [orgId])

  const handleRoleChange = (value) => {
    saveCurrentRole(value)
    setRole(value)
    setMineView('menu')
  }

  const roleName = ROLE_LABELS[role] || role

  const renderMine = () => {
    if (mineView === 'menu') {
      return (
        <Mine
          orgName={currentOrg?.name}
          role={role}
          onRoleChange={handleRoleChange}
          onOpen={setMineView}
        />
      )
    }
    return (
      <div>
        <NavBar onBack={() => setMineView('menu')} style={{ background: '#fff', marginBottom: 8 }}>
          {MINE_TITLES[mineView]}
        </NavBar>
        {mineView === 'schedule' && <DaySchedule />}
        {mineView === 'contribution' && <Contribution />}
        {mineView === 'income' && <IncomeCheck />}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#e9edf2', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, minHeight: '100vh', background: '#f5f5f5', paddingBottom: 50, boxShadow: '0 0 16px rgba(0,0,0,0.08)' }}>
        <NavBar
          back={null}
          style={{ background: '#1677ff', color: '#fff' }}
          right={<Space><Button size="mini" fill="none" style={{ color: '#fff' }} onClick={() => setShowMessages(true)}>消息</Button><span style={{ fontSize: 12, color: '#fff' }}>{currentOrg?.name} · {roleName}</span></Space>}
        >
          <Space align="center">
            <img src="/logo.png" alt="东方希望" style={{ height: 22 }} />
            <span>移动执行</span>
          </Space>
        </NavBar>

        {showMessages ? (
          <Messages onBack={() => setShowMessages(false)} />
        ) : selectedTicketId ? (
          <TaskDetail ticketId={selectedTicketId} onBack={() => setSelectedTicketId(null)} />
        ) : tab === 'home' ? (
          <MobileHome onNavigate={(s) => { setTaskStatus(STATUS_MAP[s] || s); setTab('tasks') }} />
        ) : tab === 'mine' ? (
          renderMine()
        ) : (
          <TaskList onOpenTicket={setSelectedTicketId} status={taskStatus} onStatusChange={setTaskStatus} />
        )}
      </div>

      <TabBar
        activeKey={tab}
        onChange={setTab}
        safeArea
        style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#fff' }}
      >
        <TabBar.Item key="home" icon={<AppOutline />} title="首页" />
        <TabBar.Item key="tasks" icon={<UnorderedListOutline />} title="任务" />
        <TabBar.Item key="mine" icon={<UserOutline />} title="我的" />
      </TabBar>
    </div>
  )
}