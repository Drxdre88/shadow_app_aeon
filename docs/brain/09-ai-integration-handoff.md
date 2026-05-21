# Track C — AI integration: Anthropic-in-the-loop for the Brain

**Status:** spec drafted 2026-05-21. Implementation NOT started.
**Branch:** `feature/brain-ai-integration` (cut from `feature/hyperspace_notes`).
**Time estimate:** 1-2 focused sessions (depends on scope chosen at boot).
**Parallel-safe with:** Track A (Cortex polish), Track B (Notes UX). Touches different files.

This track makes the Brain *intelligent*. Right now the Brain is a passive substrate: user captures, it stores, it shows. Track C adds the Anthropic API directly into the capture/retrieval/promotion flows so the system *understands* and *suggests* and *summarises*.

The user's framing: **"We need to integrate AI into [the brain] as well more directly."**

---

## 1. What exists today (don't rebuild)

- **`prepareContextForUser`** server action — BM25 + 1-hop graph walk + recency-decay scoring + budget-packed markdown bundling. This is the retrieval layer. Already optimised. **Use this.**
- **`createMemory` / `updateMemory`** — the write surface. Hooks point you can wrap to augment.
- **`@anthropic-ai/sdk`** — check if installed; if not, `npm i @anthropic-ai/sdk --workspace=apps/web`.
- **`ANTHROPIC_API_KEY`** — needs to be set in `apps/web/.env.local`. Currently not present (we've been working without it). User has access; ask for it at boot.

---

## 2. The five integrations

Each is independently shippable. Tier 1 first, then 2, then 3.

### Tier 1 — Auto-categorisation on capture (highest value, lowest risk)

When a memory is created (any source), kick off a background Haiku call to:
- Infer 2-4 relevant tags
- Suggest a memory `type` upgrade if "note" was the default but the content looks like `decision` / `fact` / `reflection`
- Generate a one-sentence `summary` if not provided

**Endpoint**: `POST /api/v1/memories/:id/auto-tag` — fire-and-forget from `createMemory` flow.

**Flow**:
1. `createMemory` writes the row.
2. After the insert returns, **don't await** — kick off the auto-tag fetch with `setImmediate` or background promise.
3. The endpoint calls `claude-haiku-4-5-20251001` with a system prompt: *"You enrich a personal memory. Given title + body, output JSON: { suggestedTags: string[], suggestedType: string, summary: string }."*
4. Result PATCHes the memory: `updateMemory(id, { tags: [...existing, ...new], type: suggestedType, summary })`.
5. Pusher broadcast (when wired) so the Cortex re-fetches.

**Why Haiku**: cheap, fast (~600ms), more than enough intelligence for tagging.

**Cost ceiling**: cap at one call per capture. Skip if body < 50 chars.

### Tier 2 — Daily Briefing generator

Move the Daily Briefing card from Track B's "just show `prepare_context` markdown" to "Claude summarises `prepare_context` markdown into a coaching brief."

**Endpoint**: `POST /api/v1/brain/briefing` (or extend the existing `prepare_context` route with a `?style=briefing` flag).

**Flow**:
1. Call `prepareContextForUser({ query: "what should I focus on today", budgetTokens: 2500 })` → returns the bundled markdown.
2. Pass to Sonnet (`claude-sonnet-4-6`) with a system prompt: *"You're a personal strategic coach. The context is a memory bundle from the user's brain. Produce a daily briefing with three sections: 1) Where you are 2) What's the biggest thing 3) What's actionable today. Cite memory IDs in [[ID]] notation. Tone: concise, surgical, not motivational."*
3. Return markdown to the Daily Briefing card on the dashboard.
4. Cache the briefing per (userId, YYYY-MM-DD) in a `daily_briefings` table OR in `memories` with `type='briefing', source='auto'`.

**Why Sonnet**: synthesis + tone work; Haiku is too terse here.

**Citations**: the rendered briefing should let the user click a `[[ID]]` and either open the memory side panel OR fly the camera to that node in Cortex (depends on whether they're on `/dashboard` or `/brain`).

### Tier 3 — Voice → STT → context highlight (the JARVIS moment)

The signature interaction from the original `06-cortex-design.md`. User hits the ● Talk button on the Cortex capture rail, says a question; the system transcribes, runs `prepare_context` on the transcript, then **lights up the relevant nodes** in the Cortex graph.

**Components**:

1. **Web Speech API hook** (`useSpeechRecognition.ts`) — wraps `SpeechRecognition` (Chrome / Edge / Android-PWA); Safari fallback = tap-to-dictate keyboard.
2. **Talk button activation** (in `CaptureRail.tsx`) — pulse animation, live transcript ticker.
3. **On final transcript**: call `prepareContextForUser({ query: transcript, budgetTokens: 1500 })`.
4. **`prepare_context` returns** memory IDs of the top-K cited memories.
5. **Cortex highlight**: emit a "focus set" event with the IDs. Cortex listens and bumps `emissiveIntensity` on those nodes for ~6 seconds. The bloom does the rest.
6. **Side panel** slides in with the bundled markdown. User can click citations to fly camera.

Optional enrichment: pipe the transcript through Claude first to *expand* the query ("remind me what we decided about RAG bifurcation" → "RAG bifurcation decision retrieval routing memory strategy") before calling `prepare_context`. Improves retrieval recall.

**Optional Tier 3.5**: TTS read-back of the briefing using Web Speech API's `speechSynthesis`. Toggleable. Phase 5+ — defer if time-bound.

### Tier 4 — Semantic link suggestions

When a memory is open in the side panel (`MemorySidePanel.tsx`), show a "Suggested links" section:

**Flow**:
1. Side panel mounts.
2. Fire `POST /api/v1/memories/:id/suggest-links` (background).
3. Endpoint calls `prepareContextForUser({ seedMemoryId: id, budgetTokens: 1000 })` to pull similar memories, then runs them through Haiku: *"Given this memory and these candidates, which 0-3 should be linked? Output JSON: [{ targetId, type, note }]. Use types: supports | contradicts | refers_to | relates | supersedes."*
4. Render the suggestions as accept/reject chips. Accept → `addLinkToMemory(seedId, { ... })`.

**Use case**: as the user accumulates memories, the brain auto-densifies. The user becomes a curator, not an author.

### Tier 5 — Memory → PBI conversion (Claude as a PM)

When a user captures an idea-shaped memory (heuristic: `type='note'` AND contains action words: "should", "need to", "build", "fix", "add"), surface a "Promote to PBI" CTA in the side panel.

**Flow**:
1. CTA click opens a modal.
2. Pre-fill: ask Claude to draft an Aeon card (title, description, checklist) from the memory body.
3. User reviews, can edit, picks project + column, confirms.
4. `createTask` writes the card. `addLinkToMemory(memoryId, { targetKind: 'task', target: newTaskId, type: 'refers_to' })` writes the link.

This is the "thought becomes work" pipeline — same hook as Track B's promote-to-card, but with Claude doing the structuring instead of the user.

---

## 3. Schema considerations

### Possibly new — `daily_briefings` table

Only if you go beyond simple memory-typed storage. Schema:

```ts
export const dailyBriefings = pgTable('daily_briefings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  bodyMd: text('body_md').notNull(),
  citations: jsonb('citations').default([]).notNull(),  // [{ memoryId, anchor }]
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqPerDay: uniqueIndex('daily_briefings_user_date').on(t.userId, t.date),
}))
```

Or just stick it in `memories` with `type='briefing', source='auto', tags=['briefing', '<YYYY-MM-DD>']`. Cleaner — no new table — but pollutes the memory graph (briefings become nodes the user didn't author). Recommend: **separate table**.

### Auto-generated tags + summary

`memories.tags` is already an array — append, don't replace.
`memories.summary` is already a column — set if null.
No schema change needed.

---

## 4. Files to create

```
apps/web/src/app/api/v1/memories/[id]/auto-tag/route.ts        # Tier 1 endpoint
apps/web/src/app/api/v1/brain/briefing/route.ts                # Tier 2 endpoint
apps/web/src/app/api/v1/memories/[id]/suggest-links/route.ts   # Tier 4 endpoint
apps/web/src/app/api/v1/memories/[id]/promote/route.ts         # Tier 5 endpoint

apps/web/src/lib/ai/anthropic.ts                               # Anthropic client singleton + cost guards
apps/web/src/lib/ai/autoTag.ts                                 # Haiku call for Tier 1
apps/web/src/lib/ai/dailyBriefing.ts                           # Sonnet call for Tier 2
apps/web/src/lib/ai/suggestLinks.ts                            # Haiku call for Tier 4
apps/web/src/lib/ai/promotePbi.ts                              # Sonnet call for Tier 5

apps/web/src/lib/hooks/useSpeechRecognition.ts                 # Web Speech API hook (Tier 3)
apps/web/src/components/brain/TalkButton.tsx                   # Cortex capture rail mic button (Tier 3)
apps/web/src/components/brain/SuggestedLinks.tsx               # side panel section (Tier 4)
apps/web/src/components/brain/PromoteToPbiModal.tsx            # memory → PBI modal (Tier 5)

apps/web/drizzle/0014_daily_briefings.sql                      # IF you go separate-table route
apps/web/src/lib/db/schema.ts                                   # add dailyBriefings table
```

## 5. Files to modify

```
apps/web/src/lib/actions/memories.ts                           # createMemory fires auto-tag
apps/web/src/components/brain/CaptureRail.tsx                  # wire <TalkButton>
apps/web/src/components/brain/MemorySidePanel.tsx              # mount <SuggestedLinks> + <PromoteToPbiModal>
apps/web/src/components/hyperspace/DailyBriefingCard.tsx       # call /api/v1/brain/briefing instead of raw prepare_context
apps/web/.env.local                                             # ANTHROPIC_API_KEY (USER PROVIDES)
```

## 6. Cost + safety guardrails

**Pricing context** (May 2026):
- Haiku 4.5: ~$0.25/M input, ~$1.25/M output
- Sonnet 4.6: ~$3/M input, ~$15/M output
- Opus 4.7: ~$15/M input, ~$75/M output

**Per-tier cost estimate** (one user, moderate activity):
- Tier 1 (auto-tag) — 1× Haiku call per capture, ~600 tokens in/out. ~10 captures/day → ~$0.002/day.
- Tier 2 (briefing) — 1× Sonnet call per day, ~3k tokens in / 800 out. ~$0.022/day.
- Tier 3 (voice) — 1× prepare_context (free, server-side) + optional 1× Haiku query expansion. Per voice command → ~$0.0005.
- Tier 4 (suggest-links) — 1× Haiku per side-panel open, ~1k in / 200 out. Browsable → ~$0.002 each.
- Tier 5 (promote PBI) — 1× Sonnet per promotion, ~1.5k in / 500 out. Rare → ~$0.015.

**Cap monthly**: $5 hard ceiling per user. Track via a `ai_usage` table or just count tokens server-side.

**Idempotency**: each AI call should be re-runnable safely. Auto-tag = upsert. Briefing = unique-per-day. Link suggestions = stateless (renderer dedupes).

**Caching**:
- Briefing — daily key, served from DB.
- Auto-tag — once per memory; skip on PATCH that already has AI-generated tags.

**Use `claude-api` skill** when wiring the Anthropic SDK calls. It handles prompt caching, model-version migration, and SDK patterns.

---

## 7. Acceptance per tier

Ship in order. Each tier is independently mergeable.

### Tier 1
- [ ] Memory created via Quick Capture gets tags + summary within 5s
- [ ] Skip rule (body < 50 chars) verified
- [ ] Tags array is appended, not replaced
- [ ] Cost telemetry present (log token counts)

### Tier 2
- [ ] Daily Briefing card renders Sonnet-summarised markdown
- [ ] Citations clickable, navigate correctly from /dashboard vs /brain
- [ ] Same-day re-renders use cache (no second Sonnet call)

### Tier 3
- [ ] Talk button in Cortex pulses on activation
- [ ] Live transcript ticker shows partial words
- [ ] On final transcript, top-K cited memories visibly bloom in graph
- [ ] Side panel opens with bundled markdown + citations

### Tier 4
- [ ] Side panel shows up to 3 suggested links
- [ ] Accept writes the link
- [ ] Suggestions don't repeat after acceptance

### Tier 5
- [ ] CTA visible only for action-ish notes
- [ ] Modal pre-fills with Sonnet-drafted task fields
- [ ] On confirm, task created + link written

---

## 8. Out of scope

- Embedding-based retrieval (we have BM25 + graph walk; embeddings are Phase 6+)
- Model routing across providers (stay Anthropic-only)
- Long-running fine-tunes / custom models (we use foundation models with system prompts)
- Multi-user team briefings (single-user only for now)
- Whisper STT — defer; ship Web Speech first
- Streaming responses to client — buffer + send once for simplicity

---

## 9. Boot

```bash
cd C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon
git checkout feature/hyperspace_notes
git checkout -b feature/brain-ai-integration

# Required reading
cat docs/brain/09-ai-integration-handoff.md   # this file
cat docs/brain/02-mcp-tools.md                # existing brain surface
cat docs/brain/04-phase-roadmap.md            # roadmap context
cat CLAUDE.md

# Ensure ANTHROPIC_API_KEY is in apps/web/.env.local (ask user if missing)
# Then load the claude-api skill before writing any AI calls:
#   /skill claude-api
# It will guide on prompt caching, model versions, and SDK patterns.

# Implementation order (each tier is a separate PR):
# 1. Anthropic client setup + Tier 1 (auto-tag) — ship and verify
# 2. Tier 2 (briefing) — ship, demo to user
# 3. Tier 4 (suggest-links) — quality-of-life add
# 4. Tier 3 (voice) — depends on Track A's selective highlight emitter
# 5. Tier 5 (promote PBI) — quality-of-life add

npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
```
