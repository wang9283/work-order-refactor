import { useEffect, useState } from 'react'
import { Tabs } from 'antd'
import { PageHeader } from '@next/shared/ui'
import TemplateWorkspace from '@next/features/templates/TemplateWorkspace'
import TriggerRulesWorkspace from '@next/features/templates/TriggerRulesWorkspace'
import GenericPricesPanel from './GenericPricesPanel'
import AssignmentRulesPanel from './AssignmentRulesPanel'

export default function OtherBusinessWorkspace() {
  const route = window.location.hash.split('?')[0]
  const [section, setSection] = useState(() => {
    const query = new URLSearchParams(window.location.hash.includes('?') ? window.location.hash.slice(window.location.hash.indexOf('?') + 1) : '')
    return query.get('section') === 'dispatch' ? 'dispatch' : route.includes('trigger-rules') ? 'generation' : route.includes('ticket-types') ? 'types' : 'forms'
  })
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash
      const path = hash.split('?')[0]
      const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '')
      if (query.get('section') === 'dispatch') setSection('dispatch')
      else if (path.includes('trigger-rules')) setSection('generation')
      else if (path.includes('ticket-types')) setSection('types')
    }
    const onSection = (event: Event) => setSection((event as CustomEvent<string>).detail)
    window.addEventListener('hashchange', update)
    window.addEventListener('other-config-section', onSection)
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('other-config-section', onSection) }
  }, [])
  return <div className="workspace-stack">
    <PageHeader title="其他工单配置" description="维护临时与其他作业的填写模板、工单类型、生成方式和预计单价。" />
    <Tabs activeKey={section} onChange={setSection} items={[{ key: 'forms', label: '填写模板' }, { key: 'types', label: '工单类型' }, { key: 'dispatch', label: '默认派单' }, { key: 'generation', label: '生成方式' }, { key: 'prices', label: '预计单价' }]} />
    {section === 'forms' || section === 'types' ? <TemplateWorkspace initialSection={section} embedded /> : section === 'generation' ? <TriggerRulesWorkspace businessKind="generic" embedded /> : section === 'dispatch' ? <AssignmentRulesPanel /> : <GenericPricesPanel />}
  </div>
}
