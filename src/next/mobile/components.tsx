import type { ReactNode } from 'react'
import { Button, NavBar, Tag } from 'antd-mobile'
import type { OperationsTicket } from '@contracts/operations'
import dayjs from 'dayjs'

export function DateControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="mobile-date-control">
    <Button aria-label="前一天" size="small" fill="none" onClick={() => onChange(dayjs(value).subtract(1, 'day').format('YYYY-MM-DD'))}>‹</Button>
    <label><span className="mobile-sr-only">作业日期</span><input type="date" value={value} onChange={event => { if (event.target.value) onChange(event.target.value) }} /></label>
    <Button aria-label="后一天" size="small" fill="none" onClick={() => onChange(dayjs(value).add(1, 'day').format('YYYY-MM-DD'))}>›</Button>
  </div>
}

export function FullScreen({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  return <div className="mobile-screen" role="dialog" aria-modal="true" aria-label={title}>
    <NavBar onBack={onClose}>{title}</NavBar>
    <div className="mobile-screen-body">{children}</div>
    {footer && <div className="mobile-screen-footer">{footer}</div>}
  </div>
}

export function Empty({ children }: { children: ReactNode }) { return <div className="mobile-empty">{children}</div> }
export function ErrorNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="mobile-error"><span>{message}</span><Button size="small" onClick={retry}>重试</Button></div>
}
export const quantityText = (quantity: number | null | undefined) => quantity == null ? '—' : Number(quantity.toFixed(4)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
export const kindText = (kind: OperationsTicket['businessKind']) => kind === 'production' ? '生产' : kind === 'loading' ? '装卸' : '其他'

export function TicketState({ ticket }: { ticket: OperationsTicket }) {
  const label = ticket.completed
    ? '已完单'
    : ticket.status === 'cancelled'
      ? '已取消'
      : ticket.sanitation
        ? ticket.sanitation.startedAt ? '作业中' : '待开始'
        : '待完单'
  return <Tag color={ticket.completed ? 'success' : ticket.status === 'cancelled' ? 'default' : 'primary'} fill="outline">{label}</Tag>
}

export function ScopeControl({ managed, onChange, crewId, onCrewChange, crews }: {
  managed: boolean; onChange: (value: boolean) => void; crewId: string; onCrewChange: (value: string) => void; crews: Array<{ id: string; name: string }>
}) {
  if (!crews.length) return null
  return <div className="mobile-scope-control">
    <div className="mobile-mode-switch"><button className={!managed ? 'active' : ''} onClick={() => onChange(false)}>本人</button><button className={managed ? 'active' : ''} onClick={() => onChange(true)}>本组管理</button></div>
    {managed && <label className="mobile-select-label"><span>班组</span><select aria-label="管理班组" value={crewId} onChange={event => onCrewChange(event.target.value)}><option value="">全部授权班组</option>{crews.map(crew => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label>}
  </div>
}
