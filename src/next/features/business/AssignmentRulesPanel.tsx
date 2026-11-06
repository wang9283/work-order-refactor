import { useCallback, useEffect, useState } from 'react'
import { App, Alert, Button, Select, Table } from 'antd'
import type { AssignmentRule, OperationsContext } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { LoadingBlock } from '@next/shared/ui'

export default function AssignmentRulesPanel() {
  const { message } = App.useApp()
  const [context, setContext] = useState<OperationsContext | null>(null)
  const [rules, setRules] = useState<AssignmentRule[]>([])
  const load = useCallback(async () => { try { const [nextContext, nextRules] = await Promise.all([operationsApi.context(), operationsApi.assignmentRules()]); setContext(nextContext); setRules(nextRules) } catch (reason) { message.error(errorMessage(reason)) } }, [message])
  useEffect(() => { void load() }, [load])
  if (!context) return <LoadingBlock />
  const save = async (rule: AssignmentRule, crewId: string) => { try { await operationsApi.saveAssignmentRule({ siteId: rule.siteId, ticketTypeId: rule.ticketTypeId, crewId, revision: rule.revision }); await load(); message.success('默认承接作业组已保存，只影响之后新建的工单') } catch (reason) { message.error(errorMessage(reason)) } }
  const rows = context.selfCreateTemplates.filter(template => template.sanitationKind).map(template => rules.find(rule => rule.ticketTypeId === template.id)).filter((rule): rule is AssignmentRule => Boolean(rule))
  return <><Alert type="info" showIcon message="工单类型 → 默认作业组 → 当天排班 → 实际执行人" description="系统角色只控制权限，不直接决定工单执行人。每基地、每工单类型仅一个默认组；无人或资格不符时进入待分配。" style={{ marginBottom: 16 }} />
    <Table<AssignmentRule> rowKey={row => `${row.siteId}:${row.ticketTypeId}`} dataSource={rows} pagination={false} columns={[
      { title: '工单类型', dataIndex: 'ticketTypeName' },
      { title: '默认承接作业组', render: (_, rule) => <Select aria-label={`${rule.ticketTypeName}默认作业组`} value={rule.crewId} style={{ minWidth: 240 }} options={context.crews.filter(crew => crew.siteId === rule.siteId && crew.canManage).map(crew => ({ value: crew.id, label: crew.name }))} onChange={crewId => void save(rule, crewId)} /> },
      { title: '确定执行人的依据', render: () => '当天有效安排及作业资格' },
    ]} /><Button style={{ marginTop: 16 }} onClick={() => void load()}>刷新配置</Button></>
}
