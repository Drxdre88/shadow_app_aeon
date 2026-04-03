import { useEffect } from 'react'
import { View, ActivityIndicator, Text } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useAuth } from '@/lib/auth-provider'

export default function AuthCallback() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { verifyToken } = useAuth()

  useEffect(() => {
    if (token) {
      verifyToken(token).then((success) => {
        router.replace(success ? '/(tabs)' : '/login')
      })
    }
  }, [token])

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0f' }}>
      <ActivityIndicator size="large" color="#8b5cf6" />
      <Text style={{ color: '#9ca3af', marginTop: 16 }}>Signing you in...</Text>
    </View>
  )
}
