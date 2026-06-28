# Mobile App (Expo / React Native)

> Part of the Aeon architecture set — index: [../ARCHITECTURE.md](../ARCHITECTURE.md)

A native React Native companion app — the Trello model: a lean, fast mobile app for the
key flows (chat first, boards later), while power users use the full web app on iPad /
desktop. This **reverses the earlier Capacitor-over-RN decision** (2026-06-27): the
Capacitor WebView wrapper felt slow for mobile. The web app's cognition / brain / data
all stay server-side; the Expo app is a thin native client over the REST API.

**Status (2026-06-27): v1 scope = Kairos chat only. The LOGIN slice is scaffolded
(Google auth), not yet run** — it needs the operator's Google Cloud client IDs and a
one-time dev build.

## What's built

`apps/mobile/` — Expo SDK 53, React Native 0.79, React 19. No Expo Router (single-screen
for now).

| File | Role |
|---|---|
| `App.tsx` | Login screen ("Sign in with Google") → signed-in card; boot-restores a stored session |
| `src/auth.ts` | `configureGoogle`, `signInWithGoogle` (native Google sign-in → POST id token → store session token), `getStoredToken/User`, `signOut` |
| `src/api.ts` | `apiFetch` — authed REST client; attaches the `aeon_s1_…` session token as `Bearer` |
| `src/config.ts` | public config: `EXPO_PUBLIC_API_BASE_URL`, Google web/iOS client IDs |
| `app.json` | Expo config + `@react-native-google-signin/google-signin` plugin (iosUrlScheme) + `expo-secure-store` |
| `metro.config.js` | monorepo-aware Metro (watches repo root, resolves hoisted + local node_modules) |
| `README.md` | full setup + the dev-build requirement |

## How login works

1. Native Google sign-in via **`@react-native-google-signin/google-signin`** returns a Google **ID token**.
   - The older `expo-auth-session` web OAuth flow is broken on Expo SDK 53+ (iOS redirect + Android token-exchange failures), so this uses the native package. It requires a **dev build** (not plain Expo Go) — the production-correct path.
2. The app POSTs `{ idToken }` to **`/api/v1/auth/mobile/google`** (the server side already existed — see [platform.md](platform.md) §2).
3. The server verifies the token (`aud === AUTH_GOOGLE_ID`, `email_verified`), finds/creates the user, and returns a **90-day `aeon_s1_…` session token**.
4. The app stores it in the device keychain (`expo-secure-store`); `apiFetch` sends it as `Bearer` on every subsequent `/api/v1` call, where `authenticateRequest` accepts the `aeon_s1_` branch.

## Auth infrastructure reused

The native token model survived the Capacitor era: `mobile_login_tokens` + `mobile_sessions`
tables + `lib/data/mobile-auth.ts` + the `/api/v1/auth/mobile/*` routes (google / verify /
magic-link). The Expo app uses the **google** path; magic-link remains available server-side
but is not wired into the app.

## Resume / handover (operator action required)

The login slice cannot run until these one-time, operator-only steps are done (they touch
the operator's Google account, not the codebase):

1. **Google Cloud Console** — in the same project as the existing web OAuth client, create an **iOS** OAuth client (Bundle ID `app.aeon.mobile`) and, if testing on Android, an **Android** client (package `app.aeon.mobile` + SHA-1). The **web** client ID must equal the server's `AUTH_GOOGLE_ID`.
2. Fill `apps/mobile/.env` (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`) and the `iosUrlScheme` in `app.json`.
3. Add your email to `ALLOWED_EMAILS` on the web server if that allowlist is set.
4. `cd apps/mobile && npm install && npx expo install --fix && npx expo run:ios` (one-time dev build).

## Next (after login)

- **Kairos chat screen** (the commute use-case) — the planned **Aether-level** chat: talk to Kairos (the entity) backed by Aether (the super-brain), global retrieval across all Dominions + smart write-routing that auto-files takeaways to the right Dominion. See [kairos/chat.md](kairos/chat.md) "PLANNED — Aether-level mobile chat". This needs a REST + streaming exposure of the chat engine (today it's a server action) and reuses the existing BYOK LLM + retrieval.
- Simplified boards view on the same `apiFetch` rails.
