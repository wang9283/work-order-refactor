import HierarchyWorkspace from '@next/features/org/HierarchyWorkspace'
import { useEffect, useState } from 'react'
import {
  ApartmentOutlined,
  CalendarOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Alert, App as AntApp, Avatar, Button, Layout, Menu, Select, Tag, TreeSelect, Typography } from 'antd'
import { useAuth } from '@next/shared/auth'
import { errorMessage, hasAnyCapability } from '@next/shared/api'
import type { Capability, DemoIdentityId, DemoOrgOption } from '@contracts/index'
import AuditWorkspace from '@next/features/audit/AuditWorkspace'
import OrgWorkspace from '@next/features/org/OrgWorkspace'
import WorkAreasWorkspace from '@next/features/org/WorkAreasWorkspace'
import CrewWorkspace from '@next/features/org/CrewWorkspace'
import ExecutionWorkspace from '@next/features/execution/ExecutionWorkspace'
import SiteBusinessWorkspace from '@next/features/business/SiteBusinessWorkspace'
import BusinessCatalogWorkspace from '@next/features/business/BusinessCatalogWorkspace'
import MaterialsWorkspace from '@next/features/business/MaterialsWorkspace'
import PlanningWorkspace from '@next/features/planning/PlanningWorkspace'
import WorkloadsWorkspace from '@next/features/workloads/WorkloadsWorkspace'
import OtherBusinessWorkspace from '@next/features/business/OtherBusinessWorkspace'

const { Header, Sider, Content } = Layout

type PageKey =
  | 'planning'
  | 'workloads'
  | 'other-config'
  | 'org'
  | 'work-areas'
  | 'crews'
  | 'secondments'
  | 'people'
  | 'access'
  | 'production-config'
  | 'loading-config'
  | 'business-catalogs'
  | 'materials'
  | 'tickets'
  | 'audit'

const routeMap: Partial<Record<string, PageKey>> = {
  dashboard: 'planning',
  planning: 'planning',
  workloads: 'workloads',
  'other-config': 'other-config',
  org: 'org',
  'work-areas': 'work-areas',
  crews: 'crews',
  secondments: 'secondments',
  people: 'people',
  access: 'access',
  templates: 'other-config',
  'ticket-types': 'other-config',
  'business-config': 'production-config',
  'production-config': 'production-config',
  'loading-config': 'loading-config',
  'business-catalogs': 'business-catalogs',
  materials: 'materials',
  'trigger-rules': 'other-config',
  profiles: 'other-config',
  excel: 'other-config',
  tickets: 'tickets',
  prices: 'production-config',
  payroll: 'workloads',
  audit: 'audit',
}

const pages: Record<PageKey, { title: string; element: React.ReactNode }> = {
  planning: { title: '排班计划', element: <PlanningWorkspace /> },
  workloads: { title: '工作量管理', element: <WorkloadsWorkspace /> },
  'other-config': { title: '其他工单配置', element: <OtherBusinessWorkspace /> },
  org: { title: '组织管理', element: <HierarchyWorkspace /> },
  'work-areas': { title: '作业区域', element: <WorkAreasWorkspace /> },
  crews: { title: '生产班组', element: <CrewWorkspace /> },
  secondments: { title: '借调管理', element: <OrgWorkspace initialSection="secondment" /> },
  people: { title: '人员管理', element: <OrgWorkspace initialSection="people" /> },
  access: { title: '角色与数据范围', element: <OrgWorkspace initialSection="access" /> },
  'production-config': { title: '生产配置', element: <SiteBusinessWorkspace businessKind="production" /> },
  'loading-config': { title: '装卸配置', element: <SiteBusinessWorkspace businessKind="loading" /> },
  'business-catalogs': { title: '作业字典', element: <BusinessCatalogWorkspace /> },
  materials: { title: '物料档案', element: <MaterialsWorkspace /> },
  tickets: { title: '工单管理', element: <ExecutionWorkspace initialSection="tickets" /> },
  audit: { title: '操作审计', element: <AuditWorkspace /> },
}

const pageCapabilities: Record<PageKey, Capability[]> = {
  planning: ['ticket.assign'],
  tickets: ['ticket.view', 'ticket.execute'],
  workloads: ['ticket.assign', 'payroll.view'],
  org: ['org.view'],
  'work-areas': ['org.view'],
  crews: ['crew.view'],
  secondments: ['secondment.view'],
  people: ['person.view'],
  access: ['access.manage'],
  'production-config': ['ticket_type.view', 'price.view'],
  'loading-config': ['ticket_type.view', 'price.view'],
  'business-catalogs': ['business_catalog.manage'],
  materials: ['ticket_type.view', 'price.view'],
  'other-config': ['form.view', 'ticket_type.view'],
  audit: ['audit.view'],
}

interface OrgTreeOption {
  value: string
  title: string
  selectable: boolean
  children?: OrgTreeOption[]
}

/** Parent organizations only expand and locate; concrete work organizations are selectable. */
function orgTreeOptions(orgs: DemoOrgOption[]): OrgTreeOption[] {
  const roots: OrgTreeOption[] = []
  const index = new Map<string, OrgTreeOption>()
  const ensure = (key: string, title: string, selectable: boolean, parentKey: string | null): OrgTreeOption => {
    const existing = index.get(key)
    if (existing) return existing
    const node: OrgTreeOption = { value: key, title, selectable, children: [] }
    index.set(key, node)
    if (parentKey) {
      const parent = index.get(parentKey)
      if (parent) parent.children!.push(node)
      else roots.push(node)
    } else {
      roots.push(node)
    }
    return node
  }
  for (const org of [...orgs].sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'zh-Hans-CN'))) {
    let parent: OrgTreeOption | null = null
    org.path.forEach((name, depth) => {
      const isLeaf = depth === org.path.length - 1
      const key = isLeaf ? org.id : `group:${org.path.slice(0, depth + 1).join('/')}`
      parent = ensure(key, isLeaf ? `${name} · ${org.code}` : name, isLeaf, parent ? parent.value : null)
    })
  }
  const prune = (options: OrgTreeOption[]): OrgTreeOption[] => options.map((option) => ({
    ...option,
    children: option.children?.length ? prune(option.children) : undefined,
  }))
  return prune(roots)
}

export default function Shell() {
  const {
    user,
    identities,
    activeIdentity,
    orgs,
    activeOrg,
    switchIdentity,
    switchOrg,
    contextVersion,
    error,
  } = useAuth()
  const { message } = AntApp.useApp()
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  const [page, setPage] = useState<PageKey>(routeMap[route] || 'planning')
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1100)
  const canOpen = (key: PageKey) => hasAnyCapability(user, pageCapabilities[key])
  const allowedPages = (Object.keys(pageCapabilities) as PageKey[]).filter(canOpen)
  const firstAllowed = allowedPages[0] || 'tickets'
  const visiblePage = canOpen(page) ? page : firstAllowed
  const basicChildren = [
    canOpen('org') ? { key: 'org', label: '组织管理' } : null,
    canOpen('work-areas') ? { key: 'work-areas', label: '作业位置' } : null,
    canOpen('people') ? { key: 'people', label: '人员管理' } : null,
    canOpen('crews') ? { key: 'crews', label: '班组与班次' } : null,
    canOpen('secondments') ? { key: 'secondments', label: '借调管理' } : null,
    canOpen('materials') ? { key: 'materials', label: '产品物料' } : null,
    canOpen('business-catalogs') ? { key: 'business-catalogs', label: '作业字典' } : null,
  ].filter((item): item is { key: PageKey; label: string } => Boolean(item))
  const configurationChildren = [
    basicChildren.length ? { key: 'basic-group', label: '基础资料', children: basicChildren } : null,
    canOpen('production-config') ? { key: 'production-config', label: '生产配置' } : null,
    canOpen('loading-config') ? { key: 'loading-config', label: '装卸配置' } : null,
    canOpen('other-config') ? { key: 'other-config', label: '其他工单配置' } : null,
    canOpen('access') ? { key: 'access', label: '权限与数据范围' } : null,
    canOpen('audit') ? { key: 'audit', label: '操作审计' } : null,
  ].filter(Boolean)
  const menuItems = [
    canOpen('planning') ? { key: 'planning', icon: <CalendarOutlined />, label: '排班计划' } : null,
    canOpen('tickets') ? { key: 'tickets', icon: <FileTextOutlined />, label: '工单管理' } : null,
    canOpen('workloads') ? { key: 'workloads', icon: <TeamOutlined />, label: '工作量管理' } : null,
    configurationChildren.length ? {
      key: 'configuration-group',
      icon: <ApartmentOutlined />,
      label: '基础与配置',
      children: configurationChildren,
    } : null,
  ].filter(Boolean)

  const navigate = (key: PageKey) => {
    setPage(key)
    window.location.hash = `#/${key}`
  }

  const pendingTicketFocus = (id: string) => {
    setPage('tickets')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('operations-ticket-focus', { detail: id }))
    }, 0)
  }

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', '#/planning')
  }, [])

  useEffect(() => {
    if (!canOpen(page)) navigate(firstAllowed)
  }, [user?.accountId])

  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.replace(/^#\/?/, '').split('?')[0]
      setPage(routeMap[next] || 'planning')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    // Independent pages can request a configuration tab or a filtered ticket
    // list without duplicating that navigation inside their own toolbar.
    const applyQuery = () => {
      const hash = window.location.hash
      const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '')
      const section = query.get('section')
      const ticketId = query.get('ticketId')
      if (section === 'dispatch') {
        setPage('other-config')
        window.dispatchEvent(new CustomEvent('other-config-section', { detail: 'dispatch' }))
      }
      if (ticketId) {
        setPage('tickets')
        pendingTicketFocus(ticketId)
      }
    }
    applyQuery()
    window.addEventListener('hashchange', applyQuery)
    return () => window.removeEventListener('hashchange', applyQuery)
  }, [])
  useEffect(() => {
    const onPlanningFocus = (event: Event) => {
      const date = (event as CustomEvent<string>).detail
      if (date) setPage('planning')
    }
    window.addEventListener('planning-date-focus', onPlanningFocus)
    return () => window.removeEventListener('planning-date-focus', onPlanningFocus)
  }, [])

  return (
    <Layout className="app-layout">
      <Sider
        width={244}
        collapsedWidth={72}
        breakpoint="lg"
        onBreakpoint={(broken) => { if (broken) setCollapsed(true) }}
        collapsible
        trigger={null}
        collapsed={collapsed}
        className="app-sider"
      >
        <div className="sider-brand">
          <img src="/logo.svg" alt="饲料总部" />
          {!collapsed && <Tag color="gold">饲料作业</Tag>}
        </div>
        {!collapsed && (
          <div className="sider-context">
            <span>饲料作业管理</span>
            <small>排班 · 工单 · 计件工作量</small>
          </div>
        )}
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[page]}
          defaultOpenKeys={[]}
          items={menuItems}
          onClick={({ key }) => navigate(key as PageKey)}
          className="sider-menu"
        />
      </Sider>
      <Layout style={{ minWidth: 0 }}>
        <Header className="app-header">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开导航' : '收起导航'}
          />
          <div className="header-breadcrumb">
            <span>饲料作业管理</span>
            <b>/</b>
            <strong>{pages[visiblePage].title}</strong>
          </div>
          <div className="header-actions">
            <a href="/app.html" target="_blank" rel="noreferrer">员工 App</a>
            <div className="base-picker">
              <span>作业组织</span>
              <TreeSelect
                value={activeOrg?.id}
                onChange={(value) => {
                  void switchOrg(value).catch((reason) => {
                    void message.error(errorMessage(reason))
                  })
                }}
                treeData={orgTreeOptions(orgs)}
                treeDefaultExpandAll
                popupMatchSelectWidth={300}
                aria-label="切换作业组织"
              />
            </div>
            <Avatar className="user-avatar">{(user?.displayName || '用').slice(0, 1)}</Avatar>
            <div className="identity-picker">
              <span>当前身份</span>
              <Select<DemoIdentityId>
                value={activeIdentity?.id}
                onChange={(value) => void switchIdentity(value)}
                options={identities.map((identity) => ({
                  value: identity.id,
                  disabled: !identity.available,
                  label: identity.label,
                  title: `${identity.label} · ${identity.displayName}`,
                }))}
                optionRender={(option) => {
                  const identity = identities.find((item) => item.id === option.value)
                  return <div className="identity-option">
                    <b>{identity?.label}</b>
                    <small>{identity?.description}</small>
                  </div>
                }}
                popupMatchSelectWidth={300}
                aria-label="切换角色身份"
              />
              <Typography.Text>{user?.displayName}</Typography.Text>
            </div>
          </div>
        </Header>
        <Content className="app-content" key={`${user?.accountId}:${contextVersion}`}>
          {error && <Alert className="context-switch-error" type="error" showIcon message={error} />}
          {pages[visiblePage].element}
        </Content>
      </Layout>
    </Layout>
  )
}
