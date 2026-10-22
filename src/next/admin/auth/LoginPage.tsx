import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useAuth } from '@next/shared/auth'
import { errorMessage } from '@next/shared/api'

const DEMO_ACCOUNTS = [
  { username: 'group.admin', label: '总部管理员', scope: '全集团' },
  { username: 'qd.admin', label: '青岛基地管理员', scope: '青岛基地' },
  { username: 'executor.demo', label: '执行人', scope: '青岛基地' },
]

export default function LoginPage() {
  const { login } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(values: { username: string; password: string }) {
    setSubmitting(true)
    setError('')
    try {
      await login(values)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand-lockup">
          <img src="/logo.svg" alt="东方希望" />
          <span className="release-chip">GROUP OPS · 3.0</span>
        </div>
        <Typography.Title>跨基地作业，<br />从一份可信的工单开始。</Typography.Title>
        <Typography.Paragraph>
          总部冻结标准与计薪口径，基地维护本地组织并执行作业。
          人员、借调、表单版本和工资发放归属分别留痕。
        </Typography.Paragraph>
        <div className="story-grid">
          <div><strong>01</strong><span>集团标准版本不可变</span></div>
          <div><strong>02</strong><span>作业基地决定计价</span></div>
          <div><strong>03</strong><span>月底公司汇总发放</span></div>
        </div>
      </section>
      <section className="login-panel">
        <Card className="login-card">
          <div className="login-card-title">
            <span className="kicker">SECURE ACCESS</span>
            <Typography.Title level={2}>登录作业平台</Typography.Title>
            <Typography.Text type="secondary">v3 全栈新版 · 独立数据源</Typography.Text>
          </div>
          {error && <Alert type="error" showIcon message={error} className="login-error" />}
          <Form
            layout="vertical"
            initialValues={{ username: 'group.admin', password: 'Feed2026!' }}
            onFinish={(values) => void submit(values)}
          >
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="group.admin" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="Feed2026!" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
              进入集团作业台
            </Button>
          </Form>
          <div className="demo-accounts">
            <span>演示账号密码均为 Feed2026!</span>
            {DEMO_ACCOUNTS.map((account) => (
              <button key={account.username} type="button" onClick={() => void submit({ username: account.username, password: 'Feed2026!' })}>
                <span>{account.label}</span>
                <small>{account.scope}</small>
              </button>
            ))}
          </div>
        </Card>
      </section>
    </main>
  )
}
