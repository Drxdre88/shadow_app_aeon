import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryProvider } from '@/lib/query-provider'
import { AuthProvider } from '@/lib/auth-provider'

export default function RootLayout() {
  return (
    <QueryProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Slot />
      </AuthProvider>
    </QueryProvider>
  )
}
