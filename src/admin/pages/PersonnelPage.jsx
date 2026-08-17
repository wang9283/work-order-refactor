import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Modal, Form, Select, message, Card } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { saveConfig } from '@shared/store'

export default function PersonnelPage({ config, orgId, onRefresh }) {
  const [editId, setEditId] = useState(null)
  const [form] = Form.useForm()

  const persons = useMemo(() => {
    if (orgId === 'group') return config.personnel || []
    return (config.personnel || []).filter((p) => p.orgId === orgId)
  }, [config, orgId])

  const openEdit = (record) => {
    setEditId(record.id)
    form.setFieldsValue({ qualifications: record.qualifications || [] })
  }

  const saveQualifications = () => {
    const values = form.getFieldsValue()
    const person = config.personnel.find((p) => p.id === editId)
    if (person) {
      person.qualifications = values.qualifications || []
      saveConfig(config)
      message.success('资质标签已保存')
    }
    setEditId(null)
    onRefresh()
  }

  const columns = [
    { title: '工号', dataIndex: 'code', width: 110 },
    { title: '姓名', dataIndex: 'name', width: 110 },
    { title: '所属组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
    { title: '状态', dataIndex: 'status', width: 90, render: (v) => (v === 'active' ? <Tag color="green">在职</Tag> : <Tag>离职</Tag>) },
    {
      title: '资质标签', dataIndex: 'qualifications', width: 260,
      render: (v) => (v || []).map((qid) => {
        const q = config.qualifications.find((x) => x.id === qid)
        return <Tag key={qid} color="blue">{q?.name || qid}</Tag>
      }),
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_, record) => <a onClick={() => openEdit(record)}>维护资质</a>,
    },
  ]

  return (
    <Card
      title="人员档案（HR 推送，本系统只读）"
      extra={<Button icon={<SyncOutlined />} onClick={() => message.success('已模拟同步 HR 数据')}>同步HR</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={persons} pagination={{ pageSize: 8 }} size="middle" />

      <Modal title="维护资质标签" open={!!editId} onOk={saveQualifications} onCancel={() => setEditId(null)} width={480}>
        <Form form={form} layout="vertical">
          <Form.Item name="qualifications" label="资质标签">
            <Select mode="multiple" options={config.qualifications.map((q) => ({ label: q.name, value: q.id }))} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
