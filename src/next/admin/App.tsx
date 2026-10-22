import { useEffect, useState } from 'react'
import { Button, ConfigProvider, Tag } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AuthProvider, useAuth } from '@next/shared/auth'
import LoginPage from './auth/LoginPage'
import Shell from './Shell'

function AdminGate() {
  const { user, loading } = useAuth()
  if (loading) {
    return <div className="boot-screen"><div className="boot-mark">G</div><span>正在连接集团作业台</span></div>
  }
  if (!user) return <LoginPage />
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
      <AuthProvider>
        <AdminGate />
      </AuthProvider>
    </ConfigProvider>
  )
}
