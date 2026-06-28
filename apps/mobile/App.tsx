import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import {
  configureGoogle,
  getStoredUser,
  signInWithGoogle,
  signOut,
  type AeonUser,
} from './src/auth'

export default function App() {
  const [user, setUser] = useState<AeonUser | null>(null)
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    configureGoogle()
    getStoredUser()
      .then(setUser)
      .finally(() => setBooting(false))
  }, [])

  async function handleSignIn() {
    setError(null)
    setBusy(true)
    try {
      setUser(await signInWithGoogle())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    setUser(null)
  }

  if (booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    )
  }

  return (
    <View style={styles.center}>
      <StatusBar style="light" />
      <Text style={styles.brand}>Aeon</Text>

      {user ? (
        <View style={styles.card}>
          {user.image ? (
            <Image source={{ uri: user.image }} style={styles.avatar} />
          ) : null}
          <Text style={styles.name}>{user.name ?? user.email}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <Text style={styles.role}>signed in · {user.role}</Text>
          <Pressable style={styles.ghost} onPress={handleSignOut}>
            <Text style={styles.ghostText}>Sign out</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#0b0b0f" />
          ) : (
            <Text style={styles.buttonText}>Sign in with Google</Text>
          )}
        </Pressable>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0b0f',
    padding: 24,
    gap: 16,
  },
  brand: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 24,
  },
  card: { alignItems: 'center', gap: 6 },
  avatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 8 },
  name: { color: '#fff', fontSize: 20, fontWeight: '600' },
  email: { color: '#9aa0aa', fontSize: 14 },
  role: { color: '#6b7280', fontSize: 12, marginBottom: 12 },
  button: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    minWidth: 240,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0b0b0f', fontSize: 16, fontWeight: '700' },
  ghost: { paddingVertical: 10, paddingHorizontal: 20 },
  ghostText: { color: '#9aa0aa', fontSize: 14 },
  error: { color: '#f87171', fontSize: 13, textAlign: 'center' },
})
