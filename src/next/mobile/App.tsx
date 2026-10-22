import { useEffect, useState } from 'react'
import { Button, Card, Form, Input, NavBar, Space, Tag, Toast } from 'antd-mobile'
import { AuthProvider, useAuth } from '@next/shared/auth'
import { errorMessage } from '@next/shared/api'

function MobileLogin() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  async function submit(values: { username: string; password: string }) {
    setLoading(true)
    try {
      await login(values)
    } catch (reason) {
      Toast.show({ icon: 'fail', content: errorMessage(reason) })
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="mobile-login">
      <div className="mobile-brand"><img src="/logo.svg" alt="东方希望" /><Tag color="warning" fill="outline">V3</Tag></div>
      <h1>移动执行台</h1>
      <p>接收基地待办、填写冻结表单，并核对本月个人计件收入。</p>
      <Card className="mobile-login-card">
        <Form
          layout="vertical"
          initialValues={{ username: 'executor.demo', password: 'Feed2026!' }}
          onFinish={(values) => void submit(values)}
        >
          <Form.Item name="username" label="账号"><Input placeholder="executor.demo" /></Form.Item>
          <Form.Item name="password" label="密码"><Input type="password" placeholder="Feed2026!" /></Form.Item>
          <Button block color="primary" size="large" type="submit" loading={loading}>登录</Button>
        </Form>
      </Card>
    </main>
  )
}

function MobileShell() {
  const { user, logout } = useAuth()
  return (
    <div className="mobile-frame">
      <NavBar back={null} className="mobile-nav">
        <Space><img src="/logo.svg" alt="" className="nav-logo" /><span>集团作业 V3</span></Space>
      </NavBar>
      <div className="mobile-hero">
        <span className="mobile-eyebrow">TODAY / {new Date().toLocaleDateString('zh-CN')}</span>
        <h1>{user?.displayName}，准备开始作业</h1>
        <p>执行端使用独立 API。工单版本、人员归属和计价规则均以服务端记录为准。</p>
      </div>
      <Card className="mobile-status-card">
        <div className="mobile-status-row"><span>当前能力</span><b>{user?.grants.length || 0} 项</b></div>
        <div className="mobile-status-row"><span>角色范围</span><b>{user?.assignments[0]?.scope.type || '未分配'}</b></div>
        <div className="mobile-status-row"><span>数据源</span><b>V3 服务端</b></div>
      </Card>
      <div className="mobile-notice">
        <strong>执行页面接线中</strong>
        <span>Agent C 完成后，此处显示待办、动态表单、提交记录和个人收入。</span>
      </div>
      <Button block fill="outline" color="primary" onClick={() => void logout()}>退出登录</Button>
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <div className="mobile-boot">正在连接作业服务</div>
  return user ? <MobileShell /> : <MobileLogin />
}

export default function App() {
  return <AuthProvider><Gate /></AuthProvider>
}
