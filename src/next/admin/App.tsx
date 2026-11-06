import { useEffect, useState } from 'react'
import { App as AntApp, Button, ConfigProvider, Tag } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AuthProvider, useAuth } from '@next/shared/auth'
import Shell from './Shell'

function AdminGate() {
  const { user, loading, switching, error, refresh } = useAuth()
  if (loading || switching) {
    return <div className="boot-screen"><div className="boot-mark">F</div><span>正在连接饲料总部作业台</span></div>
  }
  if (!user) {
    return (
      <main className="context-error-screen">
        <img src="/logo.svg" alt="饲料总部" />
        <h1>作业台暂时无法进入</h1>
        <p>{error || '没有可用的演示身份'}</p>
        <Button type="primary" onClick={() => void refresh()}>重新连接</Button>
      </main>
    )
  }
  return <Shell />
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0b5d4b',
          colorInfo: '#0b5d4b',
          colorSuccess: '#2f855a',
          colorWarning: '#c47f17',
          colorError: '#b42318',
          borderRadius: 10,
          fontFamily: '"Microsoft YaHei UI", "Noto Sans SC", sans-serif',
        },
      }}
    >
      <AntApp>
        <AuthProvider surface="admin">
          <AdminGate />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  )
}
