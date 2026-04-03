# INFERNO ENGINEER BLUEPRINT: Aeon React Native MVP

## Mission

Build a React Native mobile app (apps/mobile/) inside the existing Turborepo monorepo that delivers project list, board view with drag-and-drop, realm navigation, and authentication. The mobile app calls the existing REST API (/api/v1/) hosted on Vercel, reuses @aeon/shared types and utilities, and uses Expo Router + NativeWind for navigation and styling. Network-required (no offline). Android-first, iOS by default via Expo.

---

## Current State

### What exists today

- **Monorepo:** npm workspaces. Root package.json has workspaces: ["apps/*", "packages/*"]. No turbo.json — plain npm workspaces, not Turborepo with caching.
  - apps/web/ -- Next.js 16 web app (fully built)
  - apps/desktop/ -- Tauri scaffold (empty shell, `"@aeon/shared": "*"` dep pattern — precedent for mobile)
  - packages/shared/ -- @aeon/shared package (types, themes, filters, defaults). See Shared Code Reuse Plan for full export map.
- **REST API:** 34 route files under apps/web/src/app/api/v1/. Auth via session cookie OR Bearer API key. Rate-limited (200 reads/min, 60 writes/min).
- **Auth:** NextAuth v5 with database sessions (30-day), Google OAuth, GitHub OAuth (optional), Resend magic link. Session stored in sessions table (sessionToken varchar PK, userId FK, expires).
- **Zustand stores** (web-specific, in apps/web/src/lib/store/): boardStore.ts, canvasStore.ts, ganttStore.ts, undoStore.ts. Plus themeStore.ts and sidebarStore.ts in apps/web/src/stores/. Note: boardStore.ts duplicates BoardColumn/BoardTask/ChecklistSummary types from @aeon/shared — mobile must import from shared, not duplicate.
- **API auth mechanism** (apps/web/src/lib/api/auth.ts): authenticateRequest() checks for Bearer header first. If present: checks master key, then aeon_k1_ prefix for API keys. **If Bearer is present but invalid, returns hard 401 — never falls through to session.** Only when no Authorization header exists does it fall back to NextAuth cookie session via auth().

### Gaps and risks

- **No mobile auth endpoint.** NextAuth database sessions use cookies. Need a token-based auth flow with new token format (aeon_s1_ prefix).
- **Zustand stores are web-coupled.** boardStore.ts uses zustand/persist with browser localStorage. Cannot be imported as-is.
- **No /me or /preferences REST endpoints.** Mobile needs both for auth hydration and settings.
- **Sync endpoint is outside /api/v1/.** `api/sync/version/[projectId]` uses cookie-only auth (calls auth() directly, no authenticateRequest). Must be updated or replicated under /api/v1/ for mobile Bearer token access.
- **Realm projects route has non-awaited params.** `realms/[realmId]/projects/route.ts` skips await on params — Next.js 15 dynamic route params are a Promise. Will silently return 403. Must fix.

---

## Requirements

### Functional

1. **Auth screen:** Sign in via Google OAuth (`@react-native-google-signin/google-signin` — native, not web-based AuthSession which is broken on Android SDK 53+) or magic link (email input, deep link back)
2. **Realm list:** Show user realms with icons/colors, personal realm auto-selected on launch
3. **Project list:** Show projects within selected realm, with name/planet image/updated time
4. **Board view:** Columns rendered horizontally (swipeable), cards within columns rendered vertically
5. **Card detail:** View/edit task name, description, priority, labels, checklist summary
6. **Quick add:** Add a new task to a column from the board view
7. **Theme support:** Apply user selected theme (colors only, no effects/particles/cursor)
8. **Pull-to-refresh** on project list and board view

### Non-functional

- **Network-required.** No offline cache for MVP.
- **Performance.** Board with 50-100 cards per project should render smoothly. Virtualized lists with getItemLayout for columns with 20+ cards.
- **Security.** Auth tokens (aeon_s1_ prefix) stored in expo-secure-store (encrypted at rest), never in AsyncStorage. Magic link tokens are single-use (delete-on-exchange).
- **Size.** Expo managed workflow with development builds (EAS Build). No bare workflow ejection. Development builds required for native Google Sign-In + MMKV. No Expo Go support.

### Scope boundaries

- **IN:** Auth, realm nav, project list, board view, card move, card detail (view/edit), quick add, theme colors, pull-to-refresh.
- **OUT:** Gantt, Canvas, Trophy, Velocity, theme editor, visual effects, celebrations, keyboard shortcuts, MCP, command palette, undo stack, share/invite from mobile, push notifications, offline mode.

---

## Architecture Decision Records

### ADR-1: Mobile Auth via Session Token Exchange (aeon_s1_ prefix)

**Context:** Mobile apps cannot use browser cookies for NextAuth session management. authenticateRequest() currently only recognizes master key and aeon_k1_ API keys in Bearer header.

**Decision:** Add POST /api/v1/auth/mobile endpoint. Accepts Google OAuth id_token (from `@react-native-google-signin/google-signin` — native sign-in, not Expo AuthSession which is broken on Android SDK 53+) or magic link token. Backend verifies, finds/creates user, creates session row in NextAuth's exact format (opaque sessionToken as varchar PK, userId FK, expires timestamp). Session token is prefixed with `aeon_s1_` to distinguish from API keys. Add a third branch in authenticateRequest(): tokens starting with `aeon_s1_` are looked up in sessions table (SELECT userId, expires WHERE sessionToken = ? AND expires > now()), returning user. This requires ~15-25 lines including imports, DB query, and expiry check.

**Security constraints:**
- Token comparison via DB lookup (no string ===) to avoid timing attacks
- Magic link tokens: delete verification_tokens row atomically after exchange (single-use)
- Magic link TTL: 5-10 minutes
- Deep link scheme (aeon://) registration in app.json for both Android/iOS
- Clear deep link URL from navigation stack after callback to prevent token leakage

**Consequences+:** Standard OAuth UX. Tokens auto-expire (30 days). User profile from session. Same session table as web.

**Consequences-:** New endpoint to maintain. Google Sign-In requires development builds (no Expo Go) + config plugin setup. Token refresh = re-auth after 30 days.

**Alternatives considered:** API key auth (poor UX, always companion app), NextAuth credentials provider (requires SSR), Custom JWT (unnecessary when DB sessions exist), API key bootstrap then OAuth later (throwaway work)

**Status:** proposed

---

### ADR-2: Simplified DnD for MVP (Action Sheet Move)

**Context:** Cross-column touch DnD requires gesture handler + reanimated + custom hit detection (3-5 day effort). Trello mobile validates the action sheet pattern.

**Decision:** Long-press card triggers action sheet with column names. Tapping column calls PUT /api/v1/projects/[id]/tasks/[taskId] with new columnId. Within-column reorder deferred.

**Consequences+:** Zero DnD dependency. Ships fast. Simple, predictable.

**Consequences-:** Not as fluid as drag. No within-column reorder.

**Post-MVP:** `react-native-reanimated-dnd` (actively maintained, Reanimated 4, supports New Architecture) for real cross-column drag. Leaf component swap (MoveToColumnSheet -> DragHandle), no data flow change.

**Status:** proposed

---

### ADR-3: NativeWind v4 for Styling (Colors via React Context, Not CSS Vars)

**Context:** Web uses Tailwind CSS. Need mobile styling with shared vocabulary.

**Decision:** NativeWind v4.2.0+ (Tailwind compiled to RN StyleSheet, pinned for SDK 54/Reanimated 4 compat) for structural/spacing classes. **Theme colors via React context, NOT CSS variables.** CSS custom properties (--color-primary) are a browser runtime feature — React Native has no CSS variable runtime. themeAdapter.ts converts ThemeColors from @aeon/shared into a context value. ThemedView/ThemedText consume the context and apply colors as direct style props. NativeWind handles layout; theme context handles colors.

**Consequences+:** Same Tailwind class names as web for layout. Theme switching works at runtime via context re-render.

**Consequences-:** Some Tailwind classes not available in RN (backdrop-blur, box-shadow). Color application is context-based, not className-based. Monitor Uniwind (2-3x faster, Tailwind CSS v4 native) for post-MVP.

**Alternatives considered:** Raw StyleSheet (verbose), Tamagui (heavy), Unistyles (less adoption)

**Status:** proposed

---

### ADR-4: Mobile-Specific Zustand Stores (with Persist Versioning)

**Context:** Web stores use browser localStorage persist and have web-only state (cursorEffect, businessMode, etc).

**Decision:** New stores in apps/mobile/src/stores/ importing types from @aeon/shared. `react-native-mmkv` for persist (30x faster than AsyncStorage, synchronous reads, built-in encryption, first-class Zustand persist middleware). expo-secure-store for auth tokens only (authStore must NOT use MMKV persist). All persisted stores include `version: 1` and a `migrate` function stub that clears state on version mismatch from day one. MMKV requires native code — aligns with development build requirement.

**Stores:**
- authStore: non-persisted (profile hydrated from /me on cold launch, token in secure-store)
- boardUiStore: filter state only (TanStack Query owns board data)
- realmStore: activeRealmId (MMKV persist)
- themeStore: currentTheme + resolved ThemeColors (MMKV persist)

**Consequences+:** Clean, purpose-built stores. Shared types. No dead code. No silent data corruption on schema changes.

**Consequences-:** Divergence from web stores over time.

**Status:** proposed

---

### ADR-5: TanStack Query for Data Fetching (with Polling Guards)

**Context:** Web uses SSR to hydrate Zustand stores. Mobile has no SSR. Need caching and fetch lifecycle.

**Decision:** @tanstack/react-query for all API data. Zustand only for UI state.

**Polling strategy:**
- useBoardSync polls version endpoint every 10s (refetchInterval: 10000)
- Subscribe to AppState from react-native: pause polling when app is backgrounded (`enabled: appState === 'active'`)
- Set `refetchIntervalInBackground: false`
- Disable polling during mutations: `enabled: appState === 'active' && !isMutating` to prevent optimistic update race conditions

**401 handling:**
- On 401 from any API call: verify token by calling GET /api/v1/me
- Only clear auth state if /me itself returns 401
- For transient 401s (server error, rate limit), show error toast and leave auth intact

**Board loading:**
- Board screen makes 3 parallel queries (columns, tasks, labels)
- Use useQueries with derived `isLoading = results.some(r => r.isLoading)` gate before rendering BoardView
- Single error boundary around all three with unified retry

**Consequences+:** Battle-tested. Handles loading/caching/staleness. Supports polling and optimistic updates.

**Consequences-:** Different pattern than web. Developers need both mental models.

**Status:** proposed

---

## Directory Structure

```
apps/mobile/
  app.json                          -- Expo config (includes aeon:// scheme)
  babel.config.js                   -- NativeWind + reanimated
  metro.config.js                   -- Monorepo resolution (SDK 54+ auto-configures, minimal config)
  nativewind-env.d.ts               -- NativeWind TS declarations
  tailwind.config.ts                -- NativeWind Tailwind config
  package.json                      -- @aeon/mobile deps ("@aeon/shared": "*")
  tsconfig.json                     -- TS config (paths for @aeon/shared)
  global.css                        -- Tailwind directives
  .env.example                      -- EXPO_PUBLIC_API_BASE_URL, Google OAuth client ID
  src/
    app/                            -- Expo Router file-based routing
      _layout.tsx                   -- Root layout (providers, token hydration)
      (auth)/
        _layout.tsx                 -- Auth layout
        sign-in.tsx                 -- Sign-in screen
        magic-link-callback.tsx     -- Deep link handler (clears URL after exchange)
      (main)/
        _layout.tsx                 -- Main layout (drawer)
        (tabs)/
          _layout.tsx               -- Tab bar
          index.tsx                 -- Dashboard / project list
          settings.tsx              -- Settings (theme, account)
        realm/
          [realmId].tsx             -- Realm project list
        project/
          [projectId]/
            _layout.tsx             -- Project layout
            board.tsx               -- Board view
            card/
              [taskId].tsx          -- Card detail
    components/
      board/
        BoardView.tsx               -- Horizontal column layout
        ColumnCard.tsx              -- Column container (FlatList + getItemLayout)
        TaskCard.tsx                -- Card in column (consistent height)
        QuickAddTask.tsx            -- Inline add
        MoveToColumnSheet.tsx       -- Action sheet for move
      card/
        CardDetail.tsx              -- Card detail view
        PriorityPicker.tsx          -- Priority selector
        LabelPicker.tsx             -- Label multi-select
        ChecklistSummary.tsx        -- Checklist badge
      realm/
        RealmList.tsx               -- Realm drawer list
        RealmPill.tsx               -- Realm pill with icon/color
      project/
        ProjectCard.tsx             -- Project list item
        ProjectList.tsx             -- List with pull-to-refresh
      ui/
        ThemedView.tsx              -- Theme context consumer (direct style props)
        ThemedText.tsx              -- Theme context consumer
        LoadingSpinner.tsx          -- Loading state
        EmptyState.tsx              -- Empty placeholder
        ActionSheet.tsx             -- Bottom sheet wrapper
        NoConnection.tsx            -- Network error + retry
    stores/
      authStore.ts                  -- Auth state (non-persisted, hydrated from /me)
      boardUiStore.ts               -- Filter state only (TanStack Query owns data)
      realmStore.ts                 -- Realm state (MMKV persist, version: 1)
      themeStore.ts                 -- Theme colors (MMKV persist, version: 1)
    lib/
      api/
        client.ts                   -- Fetch wrapper with auth + smart 401 handling
        projects.ts                 -- Project API calls
        tasks.ts                    -- Task API calls
        columns.ts                  -- Column API calls
        realms.ts                   -- Realm API calls
        auth.ts                     -- Auth API calls
      hooks/
        useProjects.ts              -- Project list hook
        useBoard.ts                 -- Board data hook (useQueries gate)
        useRealms.ts                -- Realm list hook
        usePullRefresh.ts           -- Pull-to-refresh
        useBoardSync.ts             -- Board version polling (AppState-aware)
        useAppState.ts              -- AppState subscription hook
      theme/
        ThemeContext.tsx             -- React context for resolved ThemeColors
        themeAdapter.ts             -- ThemeColors -> context value (no CSS vars)
      storage.ts                    -- expo-secure-store wrapper (2KB value limit noted)
    constants/
      api.ts                        -- Base URL, endpoints
```
---

## Screen Map

| Screen | Route | API Calls |
|--------|-------|-----------|
| Sign In | (auth)/sign-in | POST /api/v1/auth/mobile (new) |
| Magic Link | (auth)/magic-link-callback | POST /api/v1/auth/mobile (new) |
| Dashboard | (main)/(tabs)/index | GET /api/v1/realms, GET /api/v1/projects |
| Realm Projects | (main)/realm/[realmId] | GET /api/v1/realms/[realmId]/projects |
| Board View | (main)/project/[projectId]/board | GET .../columns + tasks + labels (coordinated via useQueries) |
| Card Detail | (main)/project/[projectId]/card/[taskId] | GET .../tasks/[taskId]/detail |
| Settings | (main)/(tabs)/settings | GET /api/v1/me (new), GET/PUT /api/v1/preferences (new) |

### New API endpoints needed

1. **POST /api/v1/auth/mobile** -- Token exchange. Accepts { provider, idToken } or { provider: "email", token }. Verifies token, creates session row (aeon_s1_ prefix), returns { sessionToken, user, expiresAt }. Deletes verification_tokens row on magic link exchange.
2. **GET /api/v1/me** -- Authenticated user profile ({ id, name, email, image, role }). Used for auth hydration on cold launch and settings screen.
3. **GET/PUT /api/v1/preferences** -- Read/write user preferences. Wraps existing findPreferences/upsertPreferences data layer.

### Backend fixes required

4. **Update sync endpoint auth** -- `api/sync/version/[projectId]/route.ts` must use authenticateRequest() instead of direct auth() call, or be replicated under /api/v1/. Without this, mobile polling returns 401.
5. **Fix realm projects route** -- `realms/[realmId]/projects/route.ts` must await params (Next.js 15 Promise params). Currently returns 403 silently.
6. **Add aeon_s1_ branch to authenticateRequest()** -- Third branch: tokens starting with aeon_s1_ looked up in sessions table.

---

## Auth Strategy

### Token Hydration on Cold Launch

1. _layout.tsx reads token from expo-secure-store
2. If token exists, call GET /api/v1/me with Bearer token
3. On success: hydrate authStore with user profile, navigate to (main)
4. On 401/403 from /me: clear token, navigate to (auth)/sign-in
5. On network error (not 401): show NoConnection screen with retry — do NOT clear token

### Token Storage

- expo-secure-store for sessionToken (encrypted at rest, 2KB limit — tokens are varchar(255), well within)
- authStore (Zustand, non-persisted) for user profile
- Smart 401 handling: verify via /me before clearing auth state
- 30-day expiry, re-auth on expiry for MVP

---

## Shared Code Reuse Plan

### Reusable as-is from @aeon/shared

| Export | Mobile Usage |
|--------|-------------|
| BoardColumn, BoardTask, ChecklistSummary types | Column/card rendering, API typing |
| ThemeColors type | Theme context typing |
| themes record + themeNames | Theme picker, color resolution |
| DEFAULT_PREFERENCES | Default theme values |
| INITIAL_PRIORITIES | Priority colors (use color field, not emoji name string) |
| BoardFilters + applyBoardFilters() | Client-side filtering |
| hasActiveFilters(), activeFilterCount() | Filter badge |

### Needs mobile-specific implementation

| Item | Why | Mobile Approach |
|------|-----|-----------------|
| boardStore.ts | Web persist, duplicated types, web-only state | boardUiStore: filter state only. TanStack Query owns data. |
| themeStore.ts | 100+ lines web-only state | New store: currentTheme + ThemeColors via context |
| sidebarStore.ts | Web layout concepts | New realmStore.ts: activeRealmId only |

### Not needed on mobile (MVP)

canvasStore, ganttStore, undoStore, celebration/canvas/gantt types, theme effect field, DEFAULT_SHORTCUTS

---

## Card Breakdown

| # | Card Title | Depends On | Effort | Labels |
|---|-----------|------------|--------|--------|
| 1 | Scaffold Expo app in monorepo | -- | 1 day | setup |
| 2 | Mobile auth endpoint + sign-in | 1 | 2.5 days | backend, feature |
| 3 | API client + TanStack Query setup | 1 | 1 day | setup |
| 4 | Realm nav + project list screens | 2, 3 | 1.5 days | feature, ui |
| 5 | Board view with columns + cards | 3, 4 | 2 days | feature, ui |
| 6 | Card move + quick add task | 5 | 1 day | feature |
| 7 | Card detail screen with edit | 5 | 1.5 days | feature, ui |
| 8 | Theme adapter + theme picker | 3 | 1 day | feature, ui |
| 9 | Preferences API + settings | 2, 8 | 1 day | backend, feature |
| 10 | Polish splash screen + test flows | all | 1 day | ui |

### Card 2 scope (expanded from review)

Card 2 now includes:
- POST /api/v1/auth/mobile endpoint (Google + magic link exchange)
- aeon_s1_ token prefix + sessions table row creation
- authenticateRequest() third branch for session tokens
- GET /api/v1/me endpoint (thin wrapper: authenticate, return user)
- Expo AuthSession Google OAuth flow
- Register Expo Go + production redirect URIs in Google Cloud Console
- Magic link: aeon:// deep link scheme registration in app.json
- Magic link: single-use token (delete verification_tokens on exchange, 5-10min TTL)
- expo-secure-store token storage
- Token hydration on cold launch (_layout.tsx)
- Fix sync endpoint to use authenticateRequest()
- Fix realm projects route to await params

Bumped from 2 to 2.5 days to account for backend fixes and security constraints.

### Dependency graph

```
1 (scaffold)
  |-> 2 (auth + /me + backend fixes)
  |-> 3 (API client) --+-> 4 (realm + projects)
                        |      |-> 5 (board view)
                        |            |-> 6 (card move + quick add)
                        |            |-> 7 (card detail)
                        |-> 8 (theme adapter)
                               |-> 9 (preferences) [needs 2 + 8]
all -> 10 (polish + test)
```

**Total estimated effort:** 13-15 days for a single developer.

---

## Evolution Path

### Extension points (noted, not built)

- **DnD upgrade:** Replace MoveToColumnSheet with `react-native-reanimated-dnd` (Reanimated 4, New Architecture). Leaf component swap, no data flow change.
- **Offline mode:** TanStack Query cache + MMKV persist + mutation queue = 80% offline.
- **Push notifications:** Expo Push + backend webhook on mutations. activityEvents table already captures them.
- **Real-time sync:** Replace polling with WebSocket/SSE. useBoardSync is the single swap point.
- **Apple Sign-In:** Required for iOS App Store distribution. Same token exchange pattern as Google.

### Re-architecture triggers

- 3+ features need shared business logic -> extract packages/logic/ with pure functions
- 200+ card boards degrade -> switch FlatList to FlashList with windowed rendering

---

## Horsemen Review Notes

### What was revised after review

- Changed realm nav from tab to drawer -- realms are workspace context (like Slack), not tab destinations.
- Removed task comments from card detail MVP -- poor mobile editing UX, add in follow-up.
- **[Warden critical]** Added aeon_s1_ token prefix format and third authenticateRequest() branch.
- **[Warden critical]** Added magic link single-use protection (delete-on-exchange, 5-10min TTL).
- **[Warden/Blackguard critical]** Flagged sync endpoint cookie-only auth — must update to authenticateRequest().
- **[Warden high]** Added AppState-aware polling (pause when backgrounded, disable during mutations).
- **[Warden high]** Added token hydration flow on cold launch via /me endpoint.
- **[Warden high]** Added coordinated board loading via useQueries gate.
- **[Warden high]** Smart 401 handling: verify via /me before clearing auth state.
- **[Warden medium]** Fixed NativeWind theme strategy: React context for colors, not CSS variables.
- **[Warden medium]** Added Zustand persist versioning from day one.
- **[Inquisitor high]** Bumped auth effort estimate from ~10 to 15-25 lines backend change.
- **[Inquisitor medium]** Assigned /me endpoint to Card 2 scope.
- **[Inquisitor medium]** Added deep link scheme registration to Card 2 scope.
- **[Blackguard high]** Documented session row format constraint (must replicate NextAuth format).
- **[Blackguard medium]** Added .env.example for mobile-specific env vars.
- **[Blackguard medium]** Fixed realm route non-awaited params flagged as backend fix.
- **[Butcher medium]** Collapsed Design Options A/B/C into ADR-1 alternatives. Cut ~55 lines.
- **[Butcher medium]** Collapsed DnD Library Decision into ADR-2. Cut ~12 lines.
- **[Butcher medium]** Moved auth flow steps to implementation detail, kept Token Storage.
- **[Butcher medium]** Removed API Integration Strategy section (absorbed into ADR-5).

### Remaining uncertainties

1. Expo AuthSession Google OAuth redirect URI on production builds needs testing.
2. NativeWind v4 stability with runtime theme switching via context.
3. Magic link deep linking (aeon:// scheme) on both Android and iOS — needs device testing.
4. Metro bundler monorepo resolution for @aeon/shared (watchFolders config).
5. Session row format: aeon_s1_ prefix must not conflict with NextAuth's own token generation.
