import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin'
import * as SecureStore from 'expo-secure-store'
import {
  API_BASE_URL,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from './config'

const TOKEN_KEY = 'aeon.session.token'
const USER_KEY = 'aeon.session.user'

export type AeonUser = {
  id: string
  name: string | null
  email: string
  role: string
  image: string | null
}

// Call once at app start.
export function configureGoogle() {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    offlineAccess: false,
    scopes: ['openid', 'email', 'profile'],
  })
}

// Native Google sign-in → exchange the Google ID token for an Aeon mobile
// session token (aeon_s1_…), which is then accepted as a Bearer on /api/v1.
export async function signInWithGoogle(): Promise<AeonUser> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    const response = await GoogleSignin.signIn()

    // google-signin v13+ returns { type, data }; older returns the user directly.
    const idToken =
      (response as { data?: { idToken?: string | null } })?.data?.idToken ??
      (response as { idToken?: string | null })?.idToken ??
      null
    if (!idToken) {
      throw new Error('Google sign-in was cancelled or returned no ID token')
    }

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/mobile/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    const json = (await res.json()) as
      | { data: { token: string; user: AeonUser } }
      | { error: string }
    if (!res.ok || !('data' in json)) {
      throw new Error(('error' in json && json.error) || 'Sign-in failed')
    }

    await SecureStore.setItemAsync(TOKEN_KEY, json.data.token)
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(json.data.user))
    return json.data.user
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in cancelled')
    }
    throw err
  }
}

export function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function getStoredUser(): Promise<AeonUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY)
  return raw ? (JSON.parse(raw) as AeonUser) : null
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut()
  } catch {
    // ignore — local sign-out below is what matters for the app session
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  await SecureStore.deleteItemAsync(USER_KEY)
}
