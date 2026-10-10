import type { ReactNode } from 'react'
import { SessionContext } from 'next-auth/react'

type Access = 'owner' | 'tester' | 'loading'

/** Test wrapper that provides a session the way SessionProvider does, without network. */
export function vorathSession(access: Access) {
  const value = access === 'loading'
    ? { data: null, status: 'loading' as const, update: async () => null }
    : {
        data: {
          user: { id: access === 'owner' ? 'u-owner' : 'u-tester', role: 'user', termsAccepted: true, vorath: access === 'owner' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated' as const,
        update: async () => null,
      }
  return function VorathSessionWrapper({ children }: { children: ReactNode }) {
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  }
}
