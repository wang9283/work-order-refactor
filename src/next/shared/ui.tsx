import type { ReactNode } from 'react'
import { Alert, Button, Card, Empty, Skeleton, Space, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <Typography.Title level={2}>{title}</Typography.Title>
        {description && <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>}
      </div>
      {actions && <Space wrap>{actions}</Space>}
    </div>
  )
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return <Card className="surface-card"><Skeleton active paragraph={{ rows }} /></Card>
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="加载失败"
      description={message}
      action={onRetry ? <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>重试</Button> : undefined}
    />
  )
}

export function EmptyBlock({ description = '暂无数据' }: { description?: string }) {
  return <Card className="surface-card"><Empty description={description} /></Card>
}
