import React, { useState } from 'react'
import { NavBar, TabBar, Space, Button } from 'antd-mobile'
import { AppOutline, UnorderedListOutline, CalendarOutline } from 'antd-mobile-icons'
import { loadConfig, loadCurrentOrg } from '@shared/store'
import TaskList from './pages/TaskList'
import TaskDetail from './pages/TaskDetail'
import DaySchedule from './pages/DaySchedule'
import Contribution from './pages/Contribution'
import IncomeCheck from './pages/IncomeCheck'
import MobileHome from './pages/MobileHome'
import Messages from './pages/Messages'

export default function App() {
  const [tab, setTab] = useState('home')
  const [taskStatus, setTaskStatus] = useState('all')
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [showMessages, setShowMessages] = useState(false)
  const config = loadConfig()
  const orgId = loadCurrentOrg()
  const currentOrg = config.orgs.find((o) => o.id === orgId)
  const roleName = orgId === 'group' ? '集团管理员' : '子公司配置管理员'

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
          <MobileHome onNavigate={(status) => { setTaskStatus(status); setTab('tasks') }} />
        ) : tab === 'schedule' ? (
          <DaySchedule />
        ) : tab === 'contribution' ? (
          <Contribution />
        ) : tab === 'mine' ? (
          <IncomeCheck />
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
        <TabBar.Item key="schedule" icon={<CalendarOutline />} title="日排班" />
          <TabBar.Item key="contribution" icon={<AppOutline />} title="贡献" />
          <TabBar.Item key="mine" icon={<AppOutline />} title="收入" />
      </TabBar>
    </div>
  )
}
