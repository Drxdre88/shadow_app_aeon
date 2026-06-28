// Public config — Expo inlines EXPO_PUBLIC_* at build time. No secrets here;
// these are client IDs and a base URL, all safe to ship in the bundle.

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'

// MUST equal the server's AUTH_GOOGLE_ID. The mobile login endpoint
// (/api/v1/auth/mobile/google) rejects any ID token whose `aud` is not
// AUTH_GOOGLE_ID, and google-signin stamps the ID token's audience with the
// webClientId — so these two values have to be the same Google OAuth web client.
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''

// iOS OAuth client id (from Google Cloud Console). Required for the iOS native
// flow; its reversed form also goes in app.json -> plugins iosUrlScheme.
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? ''
