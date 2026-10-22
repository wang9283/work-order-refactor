import { useEffect, useState } from 'react'
import { ArrowRightOutlined, CheckCircleOutlined, DatabaseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Button, Card, Col, Row, Statistic, Tag } from 'antd'
import type { CurrentUser } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { PageHeader, ErrorBlock, LoadingBlock } from '@next/shared/ui'
import { useAuth } from '@next/shared/auth'

interface Health {
  status: string
  version: string
  time: string
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Health>('/health').then(setHealth).catch((reason) => setError(errorMessage(reason)))
  }, [])

  if (error) return <ErrorBlock message={error} onRetry={() => window.location.reload()} />
  if (!health) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="GROUP WORK ORDER · CONTROL TOWER"
        title={`${user?.displayName}，今天的作业从这里开始`}
        description="集团标准、基地执行和月度归集共用同一套服务端数据。以下状态来自新版 API，不再读取旧版 localStorage。"
        actions={<Tag color={health.status === 'ok' ? 'success' : 'error'}>{health.status === 'ok' ? '服务正常' : '服务异常'} · v{health.version}</Tag>}
      />
      <Row gutter={[18, 18]} className="metric-grid">
        <Col xs={24} md={8}>
          <Card className="metric-card accent-green">
            <Statistic title="已授予能力" value={user?.grants.length || 0} prefix={<SafetyCertificateOutlined />} suffix="项" />
            <p>能力与基地/工区范围分别校验，服务端默认拒绝。</p>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="metric-card accent-sand">
            <Statistic title="角色范围" value={user?.assignments.length || 0} prefix={<DatabaseOutlined />} suffix="处" />
            <p>{user?.assignments.map((item) => `${item.role.name}/${item.scope.type}`).join('、') || '尚未分配业务角色'}</p>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="metric-card accent-ink">
            <Statistic title="基线状态" value="READY" prefix={<CheckCircleOutlined />} />
            <p>独立数据库、版本契约与审计日志已启用。</p>
          </Card>
        </Col>
      </Row>
      <div className="dashboard-split">
        <Card className="surface-card onboarding-card">
          <span className="kicker">IMPLEMENTATION TRACK</span>
          <h2>这次重构改变了什么</h2>
          <ol>
            <li><b>行政组织与作业结构分开。</b>公司负责工资主体，基地/工区/产线承接实际作业。</li>
            <li><b>总部标准与本地资产分开。</b>集团发布版本锁定，基地补充自己的类型与配置。</li>
            <li><b>执行归属与核算归属分开。</b>借调时按实际基地计价，月底按发放公司汇总。</li>
          </ol>
          <Button type="primary" icon={<ArrowRightOutlined />}>进入待办工单</Button>
        </Card>
        <Card className="surface-card status-card">
          <span className="kicker">LIVE FOUNDATION</span>
          <h3>当前登录</h3>
          <div className="identity-block">
            <span>{user?.displayName?.slice(0, 1)}</span>
            <div><b>{user?.displayName}</b><small>{user?.username}</small></div>
          </div>
          <p>当前身份由登录会话解析，切换演示视角不会绕过后端能力校验。</p>
        </Card>
      </div>
    </div>
  )
}
