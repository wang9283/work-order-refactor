import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CurrentUser, LoginInput } from '@contracts/index'
import { api, getToken } from './api'

interface AuthValue {
  user: CurrentUser | null
  loading: boolean
  login: (input: LoginInput) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(Boolean(getToken()))

  async function refresh(): Promise<void> {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      setUser(await api.auth.me())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function login(input: LoginInput): Promise<void> {
    const result = await api.auth.login(input)
    setUser(result.user)
  }

  async function logout(): Promise<void> {
    await api.auth.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
