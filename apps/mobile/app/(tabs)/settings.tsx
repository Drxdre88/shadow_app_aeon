import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth-provider'
import { useMe } from '@/hooks/use-me'

export default function SettingsScreen() {
  const { signOut } = useAuth()
  const { data: me } = useMe()

  return (
    <SafeAreaView style={s.safeArea} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerText}>Settings</Text>
      </View>
      <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
        {me ? (
          <View style={s.userCard}>
            <Text style={s.userName}>{me.name || 'User'}</Text>
            <Text style={s.userEmail}>{me.email}</Text>
          </View>
        ) : null}
        <Pressable onPress={signOut} style={s.signOutBtn}>
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  headerText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  userCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 24,
  },
  userName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  userEmail: { color: '#9ca3af', fontSize: 14 },
  signOutBtn: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.4)',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#f87171', fontSize: 16, fontWeight: '600' },
})
