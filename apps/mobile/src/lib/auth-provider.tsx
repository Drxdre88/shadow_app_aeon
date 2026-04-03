import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { apiClient } from './api-client'

type AuthState = {
  token: string | null
  loading: boolean
  verifyToken: (token: string) => Promise<boolean>
  signInWithGoogle: (idToken: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  token: null,
  loading: true,
  verifyToken: async () => false,
  signInWithGoogle: async () => false,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient.hasToken().then((has) => {
      if (has) setToken('exists')
      setLoading(false)
    })
  }, [])

  const verifyToken = useCallback(async (magicToken: string): Promise<boolean> => {
    try {
      const result = await apiClient.post<{ token: string }>('/auth/mobile/verify', {
        token: magicToken,
      })
      await apiClient.setToken(result.token)
      setToken(result.token)
      return true
    } catch {
      return false
    }
  }, [])

  const signInWithGoogle = useCallback(async (idToken: string): Promise<boolean> => {
    try {
      const result = await apiClient.post<{ token: string }>('/auth/mobile/google', {
        idToken,
      })
      await apiClient.setToken(result.token)
      setToken(result.token)
      return true
    } catch {
      return false
    }
  }, [])

  const signOut = useCallback(async () => {
    await apiClient.clearToken()
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, loading, verifyToken, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
