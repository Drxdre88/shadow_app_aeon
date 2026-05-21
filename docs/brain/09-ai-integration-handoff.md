# Track C — AI integration: Vercel AI SDK + BYOK, admin-gated

**Status:** spec v2 written 2026-05-21. Phase C-0 implementation in progress.
**Branch:** `feature/brain-ai-integration` (cut from `feature/hyperspace_notes`).
**Supersedes:** v1 (raw `@anthropic-ai/sdk` + shared env key). v1 was wrong for a live multi-user beta — kept in git history only.
**Parallel-safe with:** Track A (Cortex polish), Track B (Notes UX). No file collisions.

The Brain becomes intelligent: capture-time enrichment, daily briefings, voice-driven highlight, link suggestions, memory→PBI conversion. **Gated to admin role only** — beta users will not see AI features until we explicitly enable them.

---

## 1. Why v2 exists (what changed)

v1 assumed:
- Single shared `ANTHROPIC_API_KEY` in `apps/web/.env.local`
- Raw `@anthropic-ai/sdk` calls hardcoded to Anthropic
- All users see AI features

v2 corrects all three:
- **BYOK** — per-user encrypted credentials in DB. User pays for their own usage (when AI is rolled out beyond admin).
- **Vercel AI SDK v6** — unified API across 25+ providers. Swap provider by changing one config field.
- **Admin-only gate** — `users.role === 'admin'` required for every AI route and UI surface. Non-admins don't even see the nav entry.

The Vercel AI Gateway as a platform-paid fallback was considered and **deferred** — since only admin gets access right now and the admin will add their own BYOK, paying for a fallback no one will hit is wasted setup.

---

## 2. Architecture (Phase C-0 foundation)

```
apps/web/src/
├── lib/
│   ├── ai/
│   │   ├── crypto.ts          # AES-256-GCM encryption for BYOK at rest
│   │   ├── providers.ts       # Provider catalog: id, label, models, tier→modelId map
│   │   ├── router.ts          # getModelForUser(userId, tier) → AI SDK model
│   │   └── prompts.ts         # System prompts for each tier (Phase C-1)
│   ├── data/
│   │   └── ai-credentials.ts  # Pure DB queries (no auth)
│   ├── actions/
│   │   ├── ai-credentials.ts  # Server actions (auth + revalidate)
│   │   └── helpers.ts         # +requireAiAccess()
│   └── db/
│       └── schema.ts          # +userAiCredentials, +userAiPreferences
├── app/
│   ├── api/v1/ai/
│   │   ├── credentials/
│   │   │   ├── route.ts       # GET list, POST add
│   │   │   ├── [id]/route.ts  # PATCH rename, DELETE revoke
│   │   │   └── test/route.ts  # POST ping a candidate key
│   │   └── preferences/
│   │       └── route.ts       # GET/PATCH tier→model map
│   └── settings/ai/
│       └── page.tsx           # Admin-only settings page
└── drizzle/
    └── 0014_ai_integration.sql
```

### Three-layer parity

Same invariant as the rest of the app: `lib/data/` is pure DB, `lib/actions/` adds auth + revalidate, REST routes mirror MCP capabilities. **AI credential management is a settings concern, not a board concern, so MCP tools are NOT required.** Skip the parity test for this surface.

### Encryption at rest

`AI_KEYS_MASTER_KEY` env var (32 bytes, base64-encoded). AES-256-GCM. Each row stores `iv`, `authTag`, `ciphertext` separately. Decrypt only inside `lib/ai/router.ts` at request time; never log or return decrypted values.

### Provider router

```ts
// lib/ai/router.ts
export type AiTier = 'cheap' | 'standard' | 'heavy'

export async function getModelForUser(userId: string, tier: AiTier) {
  const prefs = await getUserAiPreferences(userId)
  const providerId = prefs[tier].providerId          // 'anthropic' | 'openai' | 'google'
  const modelId    = prefs[tier].modelId             // 'claude-haiku-4-5-20251001' etc.
  const cred       = await getCredential(userId, providerId)
  if (!cred) throw new AiCredentialMissingError(providerId)
  const apiKey = decryptCredential(cred)             // never logged
  return providerFor(providerId, modelId, apiKey)    // returns AI SDK model
}
```

Default tier map (overridable per user):
- `cheap`    → Anthropic `claude-haiku-4-5-20251001`
- `standard` → Anthropic `claude-sonnet-4-6`
- `heavy`    → Anthropic `claude-opus-4-7`

When BYOK is missing for a tier's chosen provider, surface a friendly error in the UI: "Add your {provider} key in /settings/ai to enable {feature}." The feature stays gracefully disabled.

---

## 3. Schema additions

```ts
export const userAiCredentials = pgTable('user_ai_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),     // 'anthropic' | 'openai' | 'google'
  label: varchar('label', { length: 100 }).notNull(),
  ciphertext: text('ciphertext').notNull(),                    // base64
  iv: text('iv').notNull(),                                    // base64
  authTag: text('auth_tag').notNull(),                         // base64
  keyHint: varchar('key_hint', { length: 16 }),                // last 4 chars for UI
  lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
  revokedAt: timestamp('revoked_at', { mode: 'date' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqUserProvider: uniqueIndex('user_ai_creds_user_provider')
    .on(t.userId, t.provider)
    .where(sql`revoked_at IS NULL`),
}))

export const userAiPreferences = pgTable('user_ai_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  cheapProviderId: varchar('cheap_provider_id', { length: 32 }).default('anthropic').notNull(),
  cheapModelId: varchar('cheap_model_id', { length: 64 }).default('claude-haiku-4-5-20251001').notNull(),
  standardProviderId: varchar('standard_provider_id', { length: 32 }).default('anthropic').notNull(),
  standardModelId: varchar('standard_model_id', { length: 64 }).default('claude-sonnet-4-6').notNull(),
  heavyProviderId: varchar('heavy_provider_id', { length: 32 }).default('anthropic').notNull(),
  heavyModelId: varchar('heavy_model_id', { length: 64 }).default('claude-opus-4-7').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

One active key per (user, provider). Revoked keys preserved for audit.

---

## 4. Admin gate

```ts
// lib/actions/helpers.ts
export async function requireAiAccess() {
  const user = await requireAuth()
  if (user.role !== 'admin') {
    throw new Error('FORBIDDEN_AI')   // mapped to 403 in route handlers
  }
  return user
}
```

Every AI-touching action and route handler calls `requireAiAccess()` first. The `/settings/ai` page does a session check at the server-component layer and `notFound()`s if non-admin — keeps the route undiscoverable.

The settings nav entry is conditionally rendered based on `session.user.role`.

---

## 5. Env vars

```bash
# apps/web/.env.local
AI_KEYS_MASTER_KEY="<base64 32 bytes>"   # REQUIRED for Phase C-0
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

NOT needed:
- `ANTHROPIC_API_KEY` — replaced by per-user BYOK
- `AI_GATEWAY_API_KEY` — Gateway fallback deferred

---

## 6. Settings UI (`/settings/ai`)

Single-page admin tool:

1. **Provider cards** — Anthropic, OpenAI, Google. Each card:
   - Status badge: "Connected (sk-…abc1)" or "Not configured"
   - Paste field with masked input + "Test & save" button
   - Last-used timestamp
   - Revoke button (with confirm)
2. **Default model picker** — for each tier (cheap / standard / heavy), select provider + model from a static catalog in `lib/ai/providers.ts`.
3. **Test connection** — sends a 5-token `"hi"` ping to the candidate model and returns latency + cost estimate. Save only on success.

No spend telemetry in Phase C-0 — defer to Phase C-2 if needed.

---

## 7. Phase C-1 — The five features (unchanged scope, rewired surface)

Each tier becomes:

```ts
const model = await getModelForUser(session.user.id, 'cheap')   // or 'standard'
const { text } = await generateText({
  model,
  system: PROMPTS.autoTag,
  prompt: buildAutoTagPrompt(memory),
})
```

Endpoints (unchanged from v1, but auth path is `requireAiAccess()` not bare auth):

```
POST /api/v1/memories/:id/auto-tag           # Tier 1 — cheap
POST /api/v1/brain/briefing                  # Tier 2 — standard
POST /api/v1/memories/:id/suggest-links      # Tier 4 — cheap
POST /api/v1/memories/:id/promote            # Tier 5 — standard
```

Tier 3 (voice → context highlight) is client-side Web Speech API + existing `prepareContextForUser`; no new AI route required.

Acceptance criteria for each tier copied from v1, unchanged.

---

## 8. Boot for Phase C-0

```bash
cd C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon
git checkout feature/hyperspace_notes
git checkout -b feature/brain-ai-integration  # already done

# Install
npm i ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google --workspace=apps/web

# Generate master key, add to apps/web/.env.local
node -e "console.log('AI_KEYS_MASTER_KEY=\"' + require('crypto').randomBytes(32).toString('base64') + '\"')" >> apps/web/.env.local

# Schema + migration
# (edit lib/db/schema.ts, then:)
npm run db:generate --workspace=apps/web

# Build everything else in the order listed under Architecture above.
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
```

---

## 9. Acceptance for Phase C-0

- [ ] `/settings/ai` renders for admin, 404s for non-admin
- [ ] Adding an Anthropic key: paste → test → save → row encrypted in DB; raw key never logged
- [ ] Revoke flow: marks `revokedAt`, unique index allows re-adding
- [ ] Default model picker: changing tier→model persists and surfaces in `getModelForUser`
- [ ] `requireAiAccess()` blocks non-admin on every route
- [ ] No `ANTHROPIC_API_KEY` referenced anywhere in code
- [ ] Typecheck + tests pass
- [ ] No regressions on existing tests

---

## 10. Out of scope (Phase C-0)

- Actual AI calls (those land in Phase C-1)
- Spend tracking + caps (Phase C-2)
- Vercel AI Gateway fallback (deferred — only needed when AI rolls out beyond admin)
- MCP tools for credential CRUD (settings concern, not board)
- Multi-user team-shared credentials (single-user only)
- Embeddings, fine-tunes (Phase 6+)
