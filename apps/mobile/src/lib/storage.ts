import { Platform } from 'react-native'

const TOKEN_KEY = 'aeon_session_token'

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(TOKEN_KEY)
  }
  const SecureStore = require('expo-secure-store')
  return SecureStore.getItemAsync(TOKEN_KEY)
}

async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token)
    return
  }
  const SecureStore = require('expo-secure-store')
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY)
    return
  }
  const SecureStore = require('expo-secure-store')
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

async function hasToken(): Promise<boolean> {
  const token = await getToken()
  return !!token
}

export const storage = { getToken, setToken, clearToken, hasToken }
