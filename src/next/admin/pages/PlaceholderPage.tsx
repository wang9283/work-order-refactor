import { Alert, Card } from 'antd'
import { PageHeader } from '@next/shared/ui'

export default function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader eyebrow="V3 MODULE" title={title} description={description} />
      <Card className="surface-card">
        <Alert
          type="info"
          showIcon
          message="模块接线中"
          description="新版总导航和鉴权已就绪。该模块由独立纵向 agent 实现，完成后将替换此占位内容。"
        />
      </Card>
    </div>
  )
}
