import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-provider'

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID

function buildGoogleAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: Math.random().toString(36).slice(2),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const { signInWithGoogle } = useAuth()

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    setError('')
    try {
      const redirectUri = Linking.createURL('auth/google')
      const authUrl = buildGoogleAuthUrl(redirectUri)
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url)
        const fragment = new URLSearchParams(url.hash.slice(1))
        const idToken = fragment.get('id_token')

        if (idToken) {
          const success = await signInWithGoogle(idToken)
          if (success) {
            router.replace('/(tabs)')
          } else {
            setError('Google sign-in failed')
          }
        } else {
          setError('No token received from Google')
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Google sign-in failed'
      setError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSend = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await apiClient.post('/auth/mobile', {
        email: email.trim(),
        callbackUrl: Linking.createURL('auth/callback'),
      })
      setSent(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to send login link'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Check your email</Text>
        <Text style={s.subtitle}>We sent a sign-in link to {email}</Text>
        <Pressable onPress={() => setSent(false)} style={{ marginTop: 32 }}>
          <Text style={s.link}>Use a different email</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={s.container}>
        <Text style={[s.title, { fontSize: 32 }]}>Aeon</Text>
        <Text style={[s.subtitle, { marginBottom: 32 }]}>
          Sign in to your workspace
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          placeholderTextColor="#666"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
        />

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Pressable
          onPress={handleSend}
          disabled={loading || !email.trim()}
          style={[s.button, { opacity: loading || !email.trim() ? 0.5 : 1 }]}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={s.buttonText}>Send sign-in link</Text>
          )}
        </Pressable>

        {GOOGLE_CLIENT_ID ? (
          <>
            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>or</Text>
              <View style={s.dividerLine} />
            </View>

            <Pressable
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
              style={[s.googleButton, { opacity: googleLoading ? 0.5 : 1 }]}
            >
              {googleLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.buttonText}>Sign in with Google</Text>
              )}
            </Pressable>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f',
    paddingHorizontal: 32,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 16,
    textAlign: 'center',
  },
  link: {
    color: '#8b5cf6',
    fontSize: 16,
  },
  input: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  error: {
    color: '#f87171',
    fontSize: 14,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  dividerText: {
    color: '#666',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  googleButton: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
})
