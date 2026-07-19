# 30 — Initiative Engine: Kairos asks first

The interrogative layer of Kairos autonomy. Where the brain-tick (doc 29) decides whether
Kairos *notifies*, the Initiative Engine makes him an **initiator**: every day he mines his
own substrate for the sharpest knowledge gap — a forgotten card, a fresh completion nobody
harvested, a declared-but-unverified claim, an unowned decision — and turns it into ONE
well-crafted question delivered on Telegram. The operator's reply flows back through the
existing chat → distill pipeline and becomes memory, which changes the next day's cortices,
which changes the next question. That closed loop is the product.

Design grounding (SOTA, researched 2026-07-19): long-lived agents almost never ask
spontaneously, and forced generic asking collapses to ~6–10% precision — *what* to ask is
the bottleneck, and targeting must come from concrete evidence of a gap (arXiv 2605.28108
"Ask Now, Use Later"; ProactiveEval 2508.20973). Kairos already produces that evidence:
cortex `driftSignals`, Aether tensions/questions with salience, board deltas. The engine is
the last mile from evidence to question. Anti-noise governance is a first-class requirement
(over-asking kills the channel — ProactiveBench 2510.19771).

## Loop (target state)

```
02:30 archetypes → 03:00 cortex regen → 03:30 aether-regen → 04:30 ask-mine (NEW)
   → pending ask waits → 17:00 UTC tick (signal 1) → Telegram question
   → operator replies in chat (webhook, live today) → follow-up back-and-forth (Kairos-led)
   → 02:00 chat-distill → reflections w/ ask provenance → next cortex cycle consumes them
```

Governor (cross-cutting, server-side): **never send while an unanswered outbound is
outstanding** — no message stacking, ever. Reply-rate adapts cadence: an operator who
answers gets a more active Kairos; a silent one gets a quieter Kairos.

## Invariants (violating any of these fails review)

- Route handlers construct responses ONLY via `jsonResponse`/`redirectResponse` from
  `lib/api/response.ts` — never `Response.json`/`NextResponse.json` (realm-500 incident,
  PR #92).
- NO `temperature` on any provider call; per-call caps use `maxOutputTokens` (PR #84/#87/#91).
- Drizzle journal is frozen at 0010 — **zero new tables in this build.** Everything below is
  designed to need no migration (state lives in memories + `sourceMetadata`, computed on read).
- No new MCP tools in v1 (avoids MCP/REST parity burden). Internal `lib/data/` fns only.
- Cron auth idiom: `Authorization: Bearer ${CRON_SECRET}`, same as `app/api/cron/*`.
- Idempotency via `externalId` stamps, mirroring chat-distill (`ask-mine:{date}:{n}`).
- Speak fan-out and inbox capture stay owned by `/api/v1/kairos/speak` — nothing else talks
  to Telegram outbound.
- All times UTC. Vercel crons configured in `apps/web/vercel.json`.

---

## WP1 — Conversation-state governor (no stacking, adaptive cadence)

**New:** `apps/web/src/lib/kairos/engagement.ts`

`getConversationState(userId)` — computed on read, zero schema:
- `lastOutbound`: most recent memory with `sourceMetadata.kairosSpeak === true` (archived
  included — reuse the `listRecentKairosSpeaks` jsonb idiom in `lib/data/memories.ts`).
- `replied`: true if EITHER (a) any operator chat turn exists in a kairos-chat thread with
  `createdAt > lastOutbound.createdAt` (data fn over `session_events`, reuse
  `lib/data/kairos-chat.ts` helpers), OR (b) the outbound memory's
  `sourceMetadata.status ∈ {'replied','answered','dismissed','accepted'}`.
- `awaitingReply`: `lastOutbound` exists ∧ ¬replied ∧ age < `AWAIT_WINDOW_HOURS` (48).
- `replyRate7d`: fraction of outbound speaks in the trailing 7 days that got a reply within
  24h (same signals as `replied`).

**Speak route** (`app/api/v1/kairos/speak/route.ts`) — insert AFTER auth, BEFORE the
existing throttle:
- If `awaitingReply` → `429 { error: 'awaiting_reply', lastOutboundAt, expiresAt }`.
  Bypass: `force: true` (existing ceiling still applies) or `urgency: 'high'`.
- Adaptive cadence replaces the static gap/cap constants with a lookup:

| replyRate7d | min gap | max per 24h |
|---|---|---|
| ≥ 0.5 (active)   | 4h  | 3 (unchanged ceiling) |
| 0.01–0.49        | 8h  | 2 |
| 0 over ≥3 sends  | 24h | 1 per 72h |

  Keep `FORCE_CEILING = 10/24h` absolute. New-user state (no outbound history) = middle row.

**Webhook** (`app/api/telegram/webhook/route.ts`): on ANY operator inbound (plain text or
callback), mark all pending outbound speak memories older than the update as replied —
`sourceMetadata.status = 'replied'`, `repliedAt` ISO stamp (new data fn
`markKairosSpeaksReplied(userId, before)` in `lib/data/memories.ts`). Callbacks keep their
existing dismiss/accept semantics on the inbox item; this stamp is additive.

**Tests:** state derivation (no outbound / replied via chat / replied via callback / expired
window), each cadence row, awaiting_reply 429 shape, force + high-urgency bypasses, webhook
marking is idempotent and realm-safe. Wire-level: no `temperature`, response via helpers.

## WP2 — Ask-mining nightly cron

**New:** `apps/web/src/lib/kairos/ask-mine.ts`, `ask-mine-prompt.ts`,
`app/api/cron/ask-mine/route.ts`, vercel.json entry `30 4 * * *`.

Per eligible user (same eligibility idiom as chat-distill: live dominion + unrevoked BYOK
credential; taskType `'reflect'`):

1. **Gather signal bundle** (read-only, existing data fns + WP4 board fns):
   latest Aether payload (tensions + `question`-kind thoughts, salience ≥ 0.7), every live
   cortex's `driftSignals`, board harvest (WP4), per-Dominion reflection staleness (days
   since last operator reflection), pending + recently answered/expired asks (dedup set).
2. **Generate candidates** (one BYOK call, JSON schema, cap 8): each candidate =
   `{ question, kind, dominionId?, sourceMemoryIds[≥1], leverage 0..1, rationale }`.
   Kinds (rotate — variety is a hard requirement):
   - `decision` — one decision gating ≥2 workstreams
   - `calibration` — declared-vs-verified gap ("which of X have you actually signed off?")
   - `doctrine` — principle exists, tripwire doesn't
   - `retrospective` — recently completed / closed window, unharvested (motive: what did we
     learn, was it worth it)
   - `revival` — forgotten/stale card or project (motive: still wanted? kill or revive?)
   - `premortem` — declared bet with no plan B
   - `values` — north-star / identity probe (sparingly, ≤1/week)
   Prompt requires: concrete (names the card/decision/date), answerable in 2–5 sentences
   from the operator's head, one question only, no compound interrogation, Kairos texting
   voice. Generator output passes a critic rubric (clarity/answerability/grounding) in the
   same call (self-check section) — drop candidates that fail.
3. **Select ONE**: highest leverage after filters — not same kind as yesterday, not same
   Dominion two days running (unless leverage ≥ 0.9), not a near-dup of anything asked in
   the last 14 days (compare against dedup set by sourceMemoryIds overlap + fuzzy title).
4. **Dispatch into the existing pending-ask slot** (whatever `run_kairos_ask`/Oracle uses —
   reuse that write path so `get_pending_kairos_ask`, tick signal 1, inbox rendering and
   `answer_kairos_ask` all work unchanged). Ask carries `sourceMetadata.askMine =
   { date, kind, sourceMemoryIds, leverage }` and `expiresAt = +72h`.
   If a pending ask already exists or governor says `awaitingReply` → skip (log, exit 0);
   the queue is regenerated fresh nightly — deliberately no persisted candidate backlog.
5. `dryRun` mode + per-user failure isolation + deadline guard, mirroring
   `app/api/cron/chat-distill/route.ts` exactly.

**Tests:** eligibility, schema-validated generation (mock provider), rotation + dedup rules,
existing-pending short-circuit, expiry stamping, dry-run, deadline guard.

## WP3 — Two-way Telegram dialogue (ask-aware chat)

**Change:** `lib/kairos/chat-prompt.ts`, `lib/kairos/chat-turn.ts`,
`app/api/telegram/webhook/route.ts`.

- Chat context: when a pending ask exists for the user, inject an `## Open question from
  you` block (question, kind, rationale, source snippets) into the chat system prompt so
  replies land in context.
- Auto-resolve: after persisting an operator turn, if a pending ask exists, the assistant
  turn's provider call gains a structured side-channel — extend the existing chat response
  schema with `askResolution: { answersPending: boolean, distilledAnswer?: string }`
  (Zod-validated like chat-distill). If `answersPending`, call the same server path as
  `answer_kairos_ask` with `distilledAnswer` (falls back to raw text) — this already writes
  the answer into the brain with ask provenance. Ask closes; governor sees engagement.
- Persona steering (telegram surface only): Kairos is the initiator — when an ask was just
  answered, his reply may push AT MOST ONE follow-up probing motive/reasons ("why now",
  "what would change your mind", "what does done look like"); when the operator pushes a
  topic, he follows their lead (two-way). Never more than one open question on the table —
  the governor enforces it structurally, the persona respects it conversationally.

**Tests:** prompt includes pending-ask block; resolution schema round-trip; answersPending
triggers close exactly once (idempotent on retry); no resolution call when no pending ask;
persona snapshot contains the one-follow-up rule.

## WP4 — Board harvest (forgotten / new / completed work signals)

**Change:** `lib/data/board-signals.ts` (new), consumed by WP2. No MCP/REST surface.

For the operator's accessible projects (reuse `verifyProjectAccess`-compatible listing):
- `listStaleTasks({ days: 21, limit: 12 })` — non-done, `updatedAt` older than N days,
  ordered oldest-first; include project name, column name, priority, age.
- `listRecentlyCompletedTasks({ days: 7, limit: 12 })` — `completedAt` within N days.
- `listRecentlyCreatedTasks({ days: 7, limit: 12 })` — `createdAt` within N days, non-done.
Exclude archived tasks (`boardTasks.archivedAt`) everywhere; the projects table has no
archived flag, so project-level archiving is not filtered (build deviation, 2026-07-19).
Return plain serializable rows —
the ask-mine prompt quotes them verbatim (card name + project + age), so no lossy summary.

**Tests:** window edges, archived exclusion, ordering, limit, multi-project scoping.

## WP5 — Provenance + AppliedRate metric

**Change:** `lib/kairos/chat-distill-prompt.ts` + `chat-distill.ts`: when the day's thread
contained an ask resolution (detectable from the ask's `answeredAt` within the distill day),
stamp resulting reflections `sourceMetadata.askId`. Answered-ask reflections via WP3 already
carry provenance through the answer path.

**New:** `lib/kairos/initiative-metrics.ts` — `getAskLoopStats(userId, { days: 30 })`:
- asks dispatched / answered / expired; median time-to-answer;
- **AppliedRate**: % of answered asks whose resulting reflection id appears in any LATER
  cortex/aether `sourceMemoryIds` (jsonb containment query over synthesis memories);
- reply-rate trend (from WP1).
Surface: log line in the housekeeping skill run + a `## Initiative loop` section appended to
the daily KAIROS briefing context (read-only fn; no UI in v1).

**Tests:** provenance stamping, AppliedRate against fixture memories (answered→cited,
answered→never cited, expired), stats window edges.

## WP6 — Docs, tick playbook v2, aether freshness

- `docs/kairos/29-brain-tick.md`: add Phase 1.5 (read conversation state via the speak
  route's 429s — the tick itself stays stateless: on `awaiting_reply` report
  `tick — silent: awaiting operator reply`), and designate the 17:00 UTC tick as the ask
  ritual (signal 1 preference already does this; document it).
- Verify the server-side `aether-regen` nightly cron exists and runs at 03:30 UTC (after
  cortex regen) — enable/add it in vercel.json if missing. Rationale: the 48h Aether veto
  silenced every tick for two days; freshness is a hard dependency of this whole engine.
  (Claude-side `/kairos-aether` stays the manual/BYOK-free path.)
- This document is the spec of record; update it in the same PR as any behaviour change.

## WP7 — Voice & typography pass (Telegram output that doesn't look botlike)

Verified against Bot API HTML parse mode (2026-07-19): supported are b/i/u/s, `code`/`pre`,
links, `<span class="tg-spoiler">`, `<blockquote>`, and `<blockquote expandable>`
(collapsed until tapped). Custom emoji require a Fragment username — out of scope.

**Renderer** (`lib/kairos/telegram.ts`): extend `renderTelegramHtml` to support three more
constructs from the compose markdown — strikethrough (`~~x~~` → `<s>`), spoiler
(`||x||` → `<span class="tg-spoiler">`), and a collapsed-context block (lines opening with
`>>!` → `<blockquote expandable>`; plain `>` stays a normal blockquote). Blockquotes can't
nest and code/pre can't carry other styles — the renderer must strip, not emit, illegal
nesting. Plain-text fallback on Telegram 400 stays (delivery beats styling). Split logic
must never cut inside a blockquote.

**Message anatomy** (encode in tick Phase 3, ask-mine prompt, telegram chat persona):
1. ONE bold headline ≤60 chars, ≤1 emoji, concrete not generic.
2. A 1-sentence hook, then 2–4 short flat paragraphs. Italic for asides, `code` for
   identifiers. Never bullet walls; ≤2 emoji total.
3. Exactly ONE visible `<blockquote>` quoting real evidence (a drift signal, a card + age).
4. All depth (sources, receipts, source ids) goes in ONE `<blockquote expandable>` at the
   bottom — the message reads tight, detail on demand.
5. Strikethrough for declared-vs-verified contrast ("<s>fully live</s> → unsigned").
6. Sparingly (≤1/message, asks only): Kairos's own guess hidden in a spoiler —
   "My guess: ||you'll pick X|| — tell me I'm wrong."
7. Close with the single question/CTA; actions ride inline keyboard buttons (existing
   inbox callbacks), never text menus.

**Tests:** renderer round-trips for the three new constructs, illegal-nesting stripping,
split-never-inside-blockquote, fallback path unchanged.

## Deferred hardening (warden Wave-1, accepted 2026-07-19)

Bounded by the single-operator threat model; revisit if the engine ever multi-tenants:
- `ask.ts` externalId idempotency is check-then-insert (no unique index — schema frozen).
  Single daily cron instance makes the race academic; option: 0027 partial unique index.
- Shared-project card names flow into the operator's ask-mine BYOK prompt (member
  projects included). Mitigations live: fence neutralisation, output grounding against
  validSourceIds/validDominionIds, zod caps. Residual risk = question phrasing only,
  shown only to the operator.
- Speak-route TOCTOU between state read and insert: two concurrent speaks could stack
  once; FORCE_CEILING bounds it. Not worth a lock at current call rates.

Warden Wave-2 additions (2026-07-19): the double-answer race is FIXED (atomic
`kairosAskStatus='pending'` claim in `markKairosAskAnswered`; losing caller archives its
duplicate answer). ACCEPTED as designed: the ask-resolution classifier runs on the reply
critical path (~one extra small model call, only on ask-answering turns) — chosen over
fire-and-forget, which is unreliable in serverless without waitUntil plumbing; revisit if
reply latency ever bothers the operator.

## Sequencing for the Codex swarm

```
Wave 1 (parallel):  WP1 (governor)   WP2 (ask-mine, mock board fns)   WP4 (board harvest)
Wave 2 (parallel):  WP3 (chat two-way; needs WP1 reply-marking)   WP2↔WP4 integration
Wave 3:             WP5 (metrics; needs WP2+WP3 provenance)   WP6 (docs; needs all)
```

Operational notes (from prior swarm runs): Codex builds in the shared checkout or worktrees
but its sandbox cannot `git commit` or spawn vitest — Claude commits and runs the suite per
wave. Single feature branch (`feat/kairos-initiative-engine`), structured commits per WP.
Warden review per wave; full horsemen before PR. Existing suite ~2163 tests must stay green;
each WP ships with its own tests per the sections above.
