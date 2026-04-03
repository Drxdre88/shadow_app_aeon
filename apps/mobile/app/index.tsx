import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '@/lib/auth-provider'

export default function Index() {
  const { token, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0f' }}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    )
  }

  if (!token) return <Redirect href="/login" />
  return <Redirect href="/(tabs)" />
}
