import { Card, Descriptions, Image, Space, Table, Tag, Typography } from 'antd'
import type { OperationsTicket } from '@contracts/operations'
import { formatDateTime } from './format'

export default function SanitationDetail({ ticket }: { ticket: OperationsTicket }) {
  const detail = ticket.sanitation
  if (!detail) return null
  return <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 20 }}>
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="作业类型">{detail.kind === 'vehicle' ? '车辆洗消' : '厂区洗消'}</Descriptions.Item>
      <Descriptions.Item label="车牌号">{detail.plateNumber || '—'}</Descriptions.Item>
      <Descriptions.Item label="任务发布">{formatDateTime(detail.publishedAt)} · {detail.publishedByName}</Descriptions.Item>
      <Descriptions.Item label="任务开始">{detail.startedAt ? `${formatDateTime(detail.startedAt)} · ${detail.startedByName}` : '尚未开始'}</Descriptions.Item>
      <Descriptions.Item label="任务结束">{detail.endedAt ? `${formatDateTime(detail.endedAt)} · ${detail.endedByName}` : '尚未结束'}</Descriptions.Item>
      <Descriptions.Item label="工作量">{ticket.completed ? `${ticket.quantity} ${detail.kind === 'vehicle' ? '辆' : '区'}` : '待完单'}</Descriptions.Item>
    </Descriptions>
    {ticket.assignmentIssue && <Tag color="orange">待分配：{ticket.assignmentIssue}</Tag>}
    {detail.kind === 'vehicle' && <>
      <Typography.Title level={5}>固定点位与演示凭证</Typography.Title>
      <EvidenceGrid ticket={ticket} />
      <Descriptions bordered size="small" column={1}><Descriptions.Item label="烘干信息">{detail.dryingRequired === null ? '待选择' : detail.dryingRequired ? `需要烘干 · ${detail.dryingMinutes ?? '待计算'} 分钟` : '不烘干'}</Descriptions.Item>{detail.dryingRequired && <Descriptions.Item label="烘干起止">{formatDateTime(detail.dryingStartedAt)} 至 {formatDateTime(detail.dryingEndedAt)}</Descriptions.Item>}</Descriptions>
    </>}
    {detail.kind === 'facility' && <><Table rowKey="key" dataSource={detail.areas} pagination={false} size="small" columns={[
      { title: '作业区域', dataIndex: 'name' },
      { title: '开始', render: (_, row) => row.startedAt ? `${formatDateTime(row.startedAt)} · ${row.startedByName}` : '—' },
      { title: '首次完成', render: (_, row) => row.completedAt ? `${formatDateTime(row.completedAt)} · ${row.completedByName}` : '—' },
      { title: '演示凭证', render: (_, row) => detail.evidence.filter(item => item.pointKey.startsWith(`area_${row.key}_`)).length },
    ]} /><EvidenceGrid ticket={ticket} /></>}
    <Card size="small" title="执行人">{ticket.workItems.flatMap(item => item.assignments).map(row => <Tag key={row.personId}>{row.personName} · {row.shareBasisPoints / 100}%</Tag>)}</Card>
    <Typography.Text type="secondary">以上为预置演示照片，尚未接入相机、相册或本地上传。</Typography.Text>
  </Space>
}
function EvidenceGrid({ ticket }: { ticket: OperationsTicket }) {
  return <Image.PreviewGroup><div className="sanitation-evidence-grid">{ticket.sanitation?.evidence.map(item => <figure key={item.id}><Image src={item.url} alt={item.pointName} /><figcaption>{item.pointName}<br />{item.operatorName} · {formatDateTime(item.createdAt)}</figcaption></figure>)}</div></Image.PreviewGroup>
}
