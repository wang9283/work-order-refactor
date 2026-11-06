import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuditOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Collapse,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { AuditLogEntry, OrgReferenceData } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'

const scopeLabels: Record<string, string> = {
  group: '全饲料总部',
  company: '公司',
  base: '基地',
  work_area: '工区',
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <Typography.Text type="secondary">—</Typography.Text>
  return (
    <Typography.Paragraph>
      <pre className="audit-json">{JSON.stringify(value, null, 2)}</pre>
    </Typography.Paragraph>
  )
}

export default function AuditWorkspace() {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canView = Boolean(user?.grants.some(
    (grant) => grant.capability === 'audit.view' && grant.type === 'group',
  ))

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [page, tree] = await Promise.all([
        api.getPage<AuditLogEntry>('/audit-logs', {
          pageSize: 200,
          q: query || undefined,
          action,
        }),
        api.get<OrgReferenceData>('/org/tree'),
      ])
      setLogs(page.items)
      setOrg(tree)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [action, canView, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const scopeName = useMemo(() => {
    const map = new Map<string, string>()
    map.set('group', '饲料总部')
    map.set('base_direct', '直属各厂')
    map.set('base_production', '生产基地')
    map.set('factory_xinjin', '新津饲料厂')
    map.set('factory_jia', '佳市饲料厂')
    map.set('factory_heze', '菏泽饲料厂')
    map.set('factory_longjiang', '龙江饲料厂')
    for (const company of org?.companies || []) map.set(company.id, company.name)
    for (const base of org?.bases || []) map.set(base.id, base.name)
    for (const area of org?.workAreas || []) map.set(area.id, area.name)
    return map
  }, [org])

  if (!canView) {
    return (
      <div>
        <PageHeader title="操作审计" description="当前账号没有饲料总部审计日志查看权限。" />
        <Card className="surface-card"><Tag>仅总部管理员可查看</Tag></Card>
      </div>
    )
  }
  if (loading) return <LoadingBlock rows={7} />
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader
        eyebrow="TRACEABILITY · COMPLIANCE"
        title="操作审计"
        description="查看组织、授权、工单和核算关键动作的账号、范围与前后值。日志只读，当前仅向总部权限管理员开放。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      <Card
        className="surface-card"
        title={<Space><AuditOutlined />关键操作留痕</Space>}
        extra={(
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索动作、对象或账号"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onSearch={() => void load()}
              style={{ width: 260 }}
            />
            <Select
              allowClear
              placeholder="全部动作"
              value={action}
              onChange={setAction}
              style={{ width: 190 }}
              options={[...new Set(logs.map((log) => log.action))].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Space>
        )}
      >
        <Table
          rowKey="id"
          dataSource={logs}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无审计记录。创建组织或保存配置后会在此留痕。' }}
          expandable={{
            expandedRowRender: (record) => (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'before',
                    label: '变更前',
                    children: <JsonBlock value={record.before} />,
                  },
                  {
                    key: 'after',
                    label: '变更后',
                    children: <JsonBlock value={record.after} />,
                  },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 170,
              render: formatDateTime,
            },
            {
              title: '操作账号',
              dataIndex: 'accountName',
              width: 140,
              render: (value: string | null, row) => value || row.accountId || '系统',
            },
            {
              title: '动作',
              dataIndex: 'action',
              width: 220,
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
            },
            {
              title: '对象',
              dataIndex: 'entityType',
              render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                  <b>{value}</b>
                  <Typography.Text type="secondary" copyable={{ text: row.entityId }}>
                    {row.entityId}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '数据范围',
              key: 'scope',
              width: 190,
              render: (_, row) => row.scopeType ? (
                <Space direction="vertical" size={0}>
                  <Tag>{scopeLabels[row.scopeType] || row.scopeType}</Tag>
                  <small>{row.scopeId ? scopeName.get(row.scopeId) || row.scopeId : '—'}</small>
                </Space>
              ) : '—',
            },
            {
              title: '来源 IP',
              dataIndex: 'ipAddress',
              width: 120,
              render: (value: string) => value || '—',
            },
          ]}
        />
      </Card>
    </div>
  )
}
