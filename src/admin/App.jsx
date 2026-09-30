import React, { useEffect, useState } from 'react'
import { Layout, Menu, Select, Space, Tag, Avatar } from 'antd'
import { FileTextOutlined, ProfileOutlined, HomeOutlined, ApartmentOutlined } from '@ant-design/icons'
import { loadConfig, loadCurrentOrg, saveCurrentOrg } from '@shared/store'
import TicketTypeList from './pages/TicketTypeList'
import FormTemplateList from './pages/FormTemplateList'
import TaskCategoryList from './pages/TaskCategoryList'
import HomePage from './pages/HomePage'
import OrgManage from './pages/OrgManage'
import ShiftManage from './pages/ShiftManage'
import DataDictManage from './pages/DataDictManage'
import ProductionLineMaterial from './pages/ProductionLineMaterial'
import PersonnelPage from './pages/PersonnelPage'
import SchedulePage from './pages/SchedulePage'
import ReportPage from './pages/ReportPage'
import ContributionPage from './pages/ContributionPage'
import ExternalSystemPage from './pages/ExternalSystemPage'
import OperationLogPage from './pages/OperationLogPage'
import MessageCenterPage from './pages/MessageCenterPage'
import NotificationConfigPage from './pages/NotificationConfigPage'
import TicketManage from './pages/TicketManage'
import IncomeCheckPage from './pages/IncomeCheckPage'
import PriceStandardPage from './pages/PriceStandardPage'

const { Header, Sider, Content } = Layout

export default function App() {
  const [config, setConfig] = useState(() => loadConfig())
  const [orgId, setOrgId] = useState(() => loadCurrentOrg())
  const [page, setPage] = useState('home')

  useEffect(() => {
    setConfig(loadConfig())
  }, [orgId])

  const refresh = () => setConfig(loadConfig())

  const handleOrgChange = (value) => {
    saveCurrentOrg(value)
    setOrgId(value)
  }

  const handleMenuClick = (e) => {
    setPage(e.key)
    if (e.key === 'home') refresh()
  }

  const currentOrg = config.orgs.find((o) => o.id === orgId)
  const roleName = orgId === 'group' ? '集团管理员' : '子公司配置管理员'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', paddingInline: 24, borderBottom: '1px solid #f0f0f0', height: 56 }}>
        <Space size={12}>
          <img src="/logo.png" alt="东方希望" style={{ height: 28 }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>用工管理平台</span>
          <Tag color="blue">v2.0</Tag>
        </Space>
        <Space size={16}>
          <Tag color="geekblue">{roleName}</Tag>
          <Select
            value={orgId}
            style={{ width: 180 }}
            onChange={handleOrgChange}
            options={config.orgs.filter((o) => o.level !== 'region').map((o) => ({ label: o.name, value: o.id }))}
          />
          <Space size={8}>
            <Avatar size={28} src="/avatar.jpg" />
            <span style={{ color: 'rgba(0,0,0,0.75)' }}>王琦淼</span>
          </Space>
        </Space>
      </Header>
      <Layout>
        <Sider width={208} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[page]}
              defaultOpenKeys={['types-group', 'execution-group']}
            onClick={handleMenuClick}
            items={[
              { key: 'home', icon: <HomeOutlined />, label: '首页' },
                {
                  key: 'types-group',
                  icon: <ProfileOutlined />,
                  label: '工单类型配置',
                  children: [
                    { key: 'types', label: '工单类型列表' },
                    { key: 'categories', label: '任务大类' },
                      { key: 'forms', label: '工单模板构建' },
                  ],
                },
              
                {
                  key: 'execution-group',
                  icon: <FileTextOutlined />,
                  label: '排班与执行',
                  children: [
                    { key: 'tickets', label: '工单管理' },
                    { key: 'schedules', label: '月排班' },
                  ],
                },
                {
                  key: 'salary-group',
                  icon: <FileTextOutlined />,
                  label: '薪酬与报表',
                  children: [
                    { key: 'reports', label: '报表中心' },
                    { key: 'salary-sub', label: '薪酬核算（低频）', children: [
                      { key: 'contribution', label: '贡献调节' },
                      { key: 'income-check', label: '收入核对' },
                      { key: 'price-standards', label: '单价/计件标准' },
                    ] },
                  ],
                },
                
                
                
                
                
                {
                  key: 'integration-group',
                  icon: <ApartmentOutlined />,
                  label: '集成与审计',
                  children: [
                    { key: 'notification-config', label: '工单通知配置' },
                    { key: 'operation-logs', label: '操作日志' },
                    { key: 'messages', label: '站内消息' },
                    { key: 'integration-sub', label: '外部集成（低频）', children: [
                      { key: 'external-systems', label: '外部系统/API Key' },
                    ] },
                  ],
                },
                {
                  key: 'reserved-group',
                  icon: <ApartmentOutlined />,
                  label: '预留功能',
                  children: [
                    { key: 'reserved-device', label: '设备档案', disabled: true },
                    { key: 'reserved-role', label: '角色管理', disabled: true },
                    { key: 'reserved-account', label: '账号管理', disabled: true },
                    { key: 'reserved-data-rule', label: '数据权限规则', disabled: true },
                    { key: 'reserved-condition', label: '条件逻辑', disabled: true },
                  ],
                },
                {
                  key: 'basic-data-group',
                  icon: <ApartmentOutlined />,
                  label: '基础主数据',
                  children: [
                    { key: 'orgs', label: '行政组织' },
                    { key: 'personnel', label: '人员档案' },
                      { key: 'shifts', label: '班次管理' },
                      { key: 'dicts', label: '数据字典' },
                      { key: 'lines-materials', label: '生产线/物料' },
                  ],
                },
            ]}
          />
        </Sider>
        <Content style={{ padding: 16, background: '#f5f5f5' }}>
          {page === 'home' && <HomePage config={config} orgId={orgId} />}
            {page === 'orgs' && <OrgManage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'personnel' && <PersonnelPage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'shifts' && <ShiftManage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'dicts' && <DataDictManage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'lines-materials' && <ProductionLineMaterial config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'schedules' && <SchedulePage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'tickets' && <TicketManage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'reports' && <ReportPage config={config} orgId={orgId} />}
            {page === 'contribution' && <ContributionPage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'income-check' && <IncomeCheckPage config={config} orgId={orgId} />}
            {page === 'price-standards' && <PriceStandardPage config={config} />}
            {page === 'external-systems' && <ExternalSystemPage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'notification-config' && <NotificationConfigPage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'operation-logs' && <OperationLogPage config={config} orgId={orgId} />}
            {page === 'messages' && <MessageCenterPage config={config} orgId={orgId} onRefresh={refresh} />}
            {page === 'types' ? (
            <TicketTypeList config={config} orgId={orgId} onRefresh={refresh} />
          ) : page === 'categories' ? (
              <TaskCategoryList config={config} orgId={orgId} onRefresh={refresh} />
            ) : (
            (page === 'forms' ? <FormTemplateList config={config} orgId={orgId} onRefresh={refresh} /> : null)
          )}
        </Content>
      </Layout>
    </Layout>
  )
}
