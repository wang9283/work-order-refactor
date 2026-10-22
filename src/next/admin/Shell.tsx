import { useState } from 'react'
import {
  ApartmentOutlined,
  AuditOutlined,
  DashboardOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { Avatar, Button, Layout, Menu, Tag, Tooltip, Typography } from 'antd'
import { useAuth } from '@next/shared/auth'
import DashboardPage from './pages/DashboardPage'
import PlaceholderPage from './pages/PlaceholderPage'

const { Header, Sider, Content } = Layout

type PageKey =
  | 'dashboard'
  | 'org'
  | 'people'
  | 'access'
  | 'templates'
  | 'ticket-types'
  | 'profiles'
  | 'excel'
  | 'tickets'
  | 'prices'
  | 'payroll'
  | 'audit'

const pages: Record<PageKey, { title: string; element: React.ReactNode }> = {
  dashboard: { title: '集团总览', element: <DashboardPage /> },
  org: { title: '组织与作业结构', element: <PlaceholderPage title="组织与作业结构" description="Agent A 正在交付基地、工区、产线和班组维护。" /> },
  people: { title: '人员与借调', element: <PlaceholderPage title="人员与借调" description="Agent A 正在交付人员资格、班组成员和借调有效期。" /> },
  access: { title: '角色与数据范围', element: <PlaceholderPage title="角色与数据范围" description="服务端权限底座已就绪，管理页面由 Agent A 交付。" /> },
  templates: { title: '表单模板', element: <PlaceholderPage title="表单模板" description="Agent B 正在交付不可变版本和动态表单设计器。" /> },
  'ticket-types': { title: '工单类型', element: <PlaceholderPage title="工单类型" description="Agent B 正在交付集团标准与公司本地类型。" /> },
  profiles: { title: '交接班式作业配置', element: <PlaceholderPage title="交接班式作业配置" description="按基地、工区、产线和班组配置工单生成规则。" /> },
  excel: { title: 'Excel 转表单', element: <PlaceholderPage title="Excel 转表单" description="Agent B 正在交付列识别、映射预览和草稿版本生成。" /> },
  tickets: { title: '工单执行', element: <PlaceholderPage title="工单执行" description="Agent C 正在交付创建、分派、动态填报和状态流转。" /> },
  prices: { title: '计价标准', element: <PlaceholderPage title="计价标准" description="Agent C 正在交付按作业基地生效的版本化单价。" /> },
  payroll: { title: '计件与月度核算', element: <PlaceholderPage title="计件与月度核算" description="作业基地计价与月底发放公司分别记录。" /> },
  audit: { title: '操作审计', element: <PlaceholderPage title="操作审计" description="统一审计底座已就绪，列表页面待集成。" /> },
}

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '集团总览' },
  {
    key: 'org-group',
    icon: <ApartmentOutlined />,
    label: '组织与主数据',
    children: [
      { key: 'org', label: '组织与作业结构' },
      { key: 'people', label: '人员与借调' },
      { key: 'access', label: '角色与数据范围' },
    ],
  },
  {
    key: 'standard-group',
    icon: <ProfileOutlined />,
    label: '工单标准',
    children: [
      { key: 'templates', label: '表单模板' },
      { key: 'ticket-types', label: '工单类型' },
      { key: 'profiles', label: '交接班式作业配置' },
      { key: 'excel', label: 'Excel 转表单' },
    ],
  },
  {
    key: 'execution-group',
    icon: <FileTextOutlined />,
    label: '执行与核算',
    children: [
      { key: 'tickets', label: '工单执行' },
      { key: 'prices', label: '计价标准' },
      { key: 'payroll', label: '计件与月度核算' },
    ],
  },
  { key: 'audit', icon: <AuditOutlined />, label: '操作审计' },
]

export default function Shell() {
  const { user, logout } = useAuth()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Layout className="app-layout">
      <Sider
        width={244}
        collapsedWidth={72}
        collapsible
        trigger={null}
        collapsed={collapsed}
        className="app-sider"
      >
        <div className="sider-brand">
          <img src="/logo.svg" alt="东方希望" />
          {!collapsed && <Tag color="gold">V3 全栈</Tag>}
        </div>
        {!collapsed && (
          <div className="sider-context">
            <span>集团作业新版</span>
            <small>独立于 v2.1 预览原型</small>
          </div>
        )}
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[page]}
          defaultOpenKeys={['org-group', 'standard-group', 'execution-group']}
          items={menuItems}
          onClick={({ key }) => setPage(key as PageKey)}
          className="sider-menu"
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开导航' : '收起导航'}
          />
          <div className="header-breadcrumb">
            <span>集团作业新版</span>
            <b>/</b>
            <strong>{pages[page].title}</strong>
          </div>
          <div className="header-actions">
            <Tag color="green">服务端鉴权</Tag>
            <a href="/app.html" target="_blank" rel="noreferrer">移动执行</a>
            <Avatar className="user-avatar">{(user?.displayName || '用').slice(0, 1)}</Avatar>
            <div className="user-copy">
              <Typography.Text strong>{user?.displayName}</Typography.Text>
              <small>{user?.assignments[0]?.role.name || '未分配角色'}</small>
            </div>
            <Tooltip title="退出登录">
              <Button type="text" icon={<LogoutOutlined />} onClick={() => void logout()} aria-label="退出登录" />
            </Tooltip>
          </div>
        </Header>
        <Content className="app-content">{pages[page].element}</Content>
      </Layout>
    </Layout>
  )
}
