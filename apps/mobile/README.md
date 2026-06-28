# Aeon Mobile (Expo)

Native companion app — **v1 is Kairos chat**; this first slice is **Google login only**.
Cognition, brain, and auth all live in `apps/web`; this app is a thin native client
over the REST API.

## What works today

- **Login with Google** → exchanges the Google ID token at
  `POST /api/v1/auth/mobile/google` for a 90-day Aeon session token
  (`aeon_s1_…`), stored in the device keychain via `expo-secure-store`.
- That token is accepted as a `Bearer` on every `/api/v1` call
  (`apps/web/src/lib/api/auth.ts` → `verifyMobileSession`).
- `src/api.ts#apiFetch` attaches it automatically — ready for the chat screen next.

The entire server side already exists; nothing to build there.

## ⚠️ Requires a dev build (not Expo Go)

`@react-native-google-signin/google-signin` ships native code, so it does **not**
run in the standard Expo Go app. You need a custom dev client. This is the current,
production-correct path — the older `expo-auth-session` Google flow is broken on
Expo SDK 53+ (iOS redirect + Android token-exchange failures).

## One-time setup

### 1. Google Cloud Console — OAuth client IDs
You already have a **Web** client (the server's `AUTH_GOOGLE_ID`). Add the mobile ones:
- **iOS** client → gives you an iOS client id. Put its *reversed* form
  (`com.googleusercontent.apps.XXXX`) into `app.json` → plugins `iosUrlScheme`.
- **Android** client → needs the package name `app.aeon.mobile` + your debug/release
  SHA-1 fingerprint (`eas credentials` or `keytool`).
- The **Web** client id is what the app passes as `webClientId` — it MUST equal the
  server's `AUTH_GOOGLE_ID`, because the login endpoint validates the ID token's
  `aud` against it.

### 2. Env
```bash
cp .env.example .env
# EXPO_PUBLIC_API_BASE_URL  -> your LAN IP:3000 for device testing, or https://aeon.app
# EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -> same value as server AUTH_GOOGLE_ID
# EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID -> iOS client id
```

### 3. Server allowlist
If `ALLOWED_EMAILS` is set on the web server, add your Google email or login 403s.

### 4. Install + dev build
```bash
cd apps/mobile
npm install
npx expo install --fix     # aligns native module versions to the installed Expo SDK
npx expo run:ios           # or: npx expo run:android  (builds + installs the dev client)
```
Then `npm start` (runs `expo start --dev-client`) for subsequent reloads.

## Files
- `App.tsx` — login screen + signed-in card (placeholder home).
- `src/auth.ts` — Google sign-in, token exchange, secure storage, sign-out.
- `src/api.ts` — `apiFetch`, the authed REST client for everything after login.
- `src/config.ts` — public config (API URL + client IDs).

## Next
- Kairos chat screen (streaming) on top of `apiFetch`.
- Simplified boards view.
