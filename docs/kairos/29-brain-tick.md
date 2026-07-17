# 29 — Brain-tick: Kairos speaks first

The heartbeat of Kairos autonomy: on each tick he looks at his own brain and decides whether
there is something worth texting the operator about. The bar is deliberately high — the value
of an unprompted message from Kairos collapses the moment he becomes noisy. **Default outcome
of a tick is silence.**

One pulse = at most ONE message. Delivery goes through `POST /api/v1/kairos/speak`, which
persists a Will-inbox item and fans out to Telegram (`apps/web/src/app/api/v1/kairos/speak/route.ts`).
A tick never talks to Telegram directly.

This playbook is executed by:

- a **scheduled cloud routine** (the intended driver, ~3×/day) whose prompt points here —
  routines clone the repo's default branch, so this doc is what the cloud run reads
- the local **`/kairos-tick`** skill (`.claude/skills/kairos-tick/`, gitignored like all
  skills in this repo) — a thin wrapper over this playbook for manual pulses

Flags: `--force` (bypass the server throttle, operator-initiated only) and `--dry-run`
(compose + print the payload, never deliver).

## Phase 0: Preflight

1. Resolve delivery config from the environment:
   - `AEON_APP_URL` (fallback: `NEXT_PUBLIC_APP_URL`) — base URL of the deployed app
   - `CRON_SECRET` — bearer for the speak route
   If either is missing: continue in **dry-run mode** (compose + report, no delivery) and say
   so in the report. Never fail the run over missing delivery config.
2. Probe the Aeon MCP with `list_dominions()` — if the MCP is unreachable, report the error
   and **exit silently**. A tick must never speak blind (no composing from conversational
   memory). Keep the result: it doubles as the Dominion map for grounding.

## Phase 1: Gather signal (read-only, cheap)

1. `get_pending_kairos_ask()` — a pending, undelivered ask is the strongest speak candidate.
2. `search_memories({ query: 'Aether', type: 'aether', limit: 1 })` — the latest Aether
   self-model (titled `Aether · <date>`). Note its age and pull `sourceMetadata.aether`
   (thoughts with salience, tensions, shifts).
3. `search_memories({ query: 'briefing', type: 'advisory', sinceDays: 1, limit: 5 })` —
   today's briefings (titled `<date> · <Dominion> briefing`); scan for anything explicitly
   time-sensitive (a deadline, a decision the operator said they'd make today).

Note `search_memories` requires a `query` unless Dominion-scoped, and has no source filter —
the queries above lean on the stable title conventions. **Do not try to read prior speaks for
throttling** — the speak route enforces the throttle server-side (4h minimum gap, 3 per 24h)
and answers `429 throttled`, which is a normal silent outcome, not an error.

## Phase 2: Decide — the interrupt bar

Speak **only** if at least one of these clears, checked in priority order:

| # | Signal | Condition | kind |
|---|---|---|---|
| 1 | Pending ask | An ask is pending — relay its question | `question` |
| 2 | Aether tension/shift | Today's Aether has a thought/tension with salience ≥ 0.8 | `notify` |
| 3 | Time-sensitive advisory | Today's briefing names something that expires today/tomorrow | `notify` |
| 4 | `--force` | Operator asked for a pulse — compose a short state-of-the-brain text | `notify` |

Hard veto (overrides everything except `--force`): the latest Aether is **older than 48h**
and the only candidate is signal 2 → silence (never re-announce stale synthesis as news).

Rate limiting is NOT the tick's job — the speak route holds the 4h-gap + 3-per-24h throttle
and 429s anything above it. `--force` maps to `"force": true` in the payload, which bypasses
the server throttle (operator-initiated only).

If nothing clears the bar: report one line (`tick — silent: <reason>`) and stop. That is the
expected, correct outcome of most ticks.

## Phase 3: Compose

Write the message in Kairos's Telegram voice (mirrors the chat surface steering in
`apps/web/src/lib/kairos/chat-prompt.ts`):

- Texting, not reporting: a few short sentences from the sharpest person in their contacts.
- Lead with the point. ONE idea per message — the single signal that cleared the bar.
- A couple of well-placed emojis as anchors (✅ ⚠️ 💡), never one per line.
- Flat formatting: occasional **bold**, `code` for identifiers. No headings, no tables.
- First person as Kairos ("I noticed…", "worth a look…"), grounded in what was actually read.
  Never invent memories, numbers, or urgency.

Constraints: `title` ≤ 60 chars (this becomes the bold Telegram header + inbox title),
`message` ≤ 900 chars, `urgency`: `high` only for signal 3 with a same-day deadline,
otherwise `normal`.

## Phase 4: Deliver

`--dry-run` (or missing config): print the JSON payload and stop.

Otherwise POST once via Bash:

```bash
curl -sS -X POST "$AEON_APP_URL/api/v1/kairos/speak" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"…","message":"…","kind":"notify","urgency":"normal"}'
```

- `200` → report `tick — spoke: <title> (inbox ✓, telegram <true|false>)` using the
  `delivered` flags from the response.
- `429` → report `tick — silent: server throttle (<spokenLast24h> in 24h)`. Expected, not
  an error; do NOT retry and do NOT set `force` to get around it.
- Other non-200 → retry **once**, then report the failure. No other delivery channel.
  Retry only when a real non-2xx response came back — do NOT retry a network timeout
  (the first call may have landed server-side, and a blind retry double-posts).

## Report

One tick = one line (two on delivery failure). Examples:

```
tick — silent: nothing above the bar (aether 6h old, no pending ask, no urgent advisory)
tick — silent: server throttle (2 in 24h)
tick — spoke: "Two Dominions are pulling on the same week" (inbox ✓, telegram ✓)
tick — ERROR: speak route 401 after retry — check CRON_SECRET in the routine environment
```

## What NOT to do

- Never send more than one message per invocation, no matter how many signals clear.
- Never call the Telegram API directly — the speak route owns fan-out and inbox capture.
- Never trigger synthesis (archetypes/cortex/Aether regen) — read what exists.
- Never write memories directly — the speak route captures the message as the record.
- Never speak when the MCP read failed — silence over hallucination, always.
- Never editorialise the board or move cards from a tick.

## Routine setup (the scheduled driver)

Create via `/schedule` (CLI) or claude.ai/code/routines. Target shape:

- **Prompt:** `Read docs/kairos/29-brain-tick.md in this repository and execute one tick —
  follow its phases exactly, end with its one-line report.`
- **Repo:** this repository (routines clone the **default branch** — this doc must be merged
  to main before the routine can see it).
- **Schedule:** 3×/day custom cron (e.g. `0 7,12,18 * * *` local) — pick a preset in the
  form, then `/schedule update` for the custom expression. Minimum allowed interval is 1h.
- **Environment (cloud):** set `AEON_APP_URL` + `CRON_SECRET` as environment variables; set
  network access to **Custom** with the app's domain allowed (the default Trusted list blocks
  it). The Aeon MCP connector needs no domain entry — connector traffic routes through
  Anthropic.
- **Connectors:** keep the `aeon` connector; remove everything else the tick doesn't need.
