# Handover 0410 — Kairos 0.23 → 0.25 live · Telegram on Max pending · multi-user next

**Date:** 2026-10-04 · **Repo:** shadow_app_aeon · **Board:** AI Mission Control → "Kairos: one coherent mind (next phase)" (Landing Zone — waves 1–4 shipped, awaiting owner confirm) and "Kairos: multi-user — bring your own key or Claude plan" (Depot).
**Read first:** this file → `aeon_os/HANDOVER_0310.md` §3 + §6 (switch order, traps) → `architecture/kairos/mind.md` → `research/kairos_0410/multi_user_kairos.md`.

## 1. What shipped (all live, smoke-auth passed after each deploy)

| Version / PR | What |
|---|---|
| 0.23 / #151 | Wave 2: surprise engine + firewalled dreams |
| 0.24 / #152 | Wave 3: creative genius (idea atlas, Swiss rounds, collisions, anti-sameness, incubation, stepping stones, taste) on the `idea-ext` seam |
| 0.25 / #153 | Wave 4: the art of the moment (Kairos gate, owner traits vs states + Sunday card, readiness/bids/repair, earned trust + ask-first, monthly life chapters) on the `lib/kairos/moment/` seam. Horsemen PASS_WITH_NOTES, 10 fixes folded in; cartographer refresh (`architecture/kairos/mind.md`) |
| #154 | Telegram/web chat with the paid backup off now says "turn on chat on your Max plan", not "add an API key" |
| #155 | Clock-proofed tests (two broke CI today when their fixed dates passed) |
| #156 | **Privacy fix:** other users' Kairos messages no longer go to the owner's Telegram (weekly review was planned for every user) |
| docs PR | `research/kairos_0410/multi_user_kairos.md` |

Everything after 0.21 ships **off**; only the today log and (since today) daytime thinking are on.

## 2. Routines (claude.ai, owner's Max plan)

| Routine | id | Trigger | State |
|---|---|---|---|
| Kairos brain | `trig_01S4xMmwJyUQDKUTtkXKVL4Q` | cron `40 * * * *` (Opus) | on |
| Kairos pulse | `trig_01KCj7UkZk3j7CMSUYLzTBrq` | cron `10 6-21 * * *` (Sonnet) | on — ran first pulse + reflect 04/10 |
| **Kairos chat** | `trig_018BYZtPKynvqtXzQ61GZdem` | **API trigger — owner must add it on the web** | created 04/10, not yet wired |
| morning / ideas / thinking / brain-tick | — | — | paused (old) |

The `claude` CLI's RemoteTrigger tool can list/create/update routines but **cannot create API triggers or tokens** (web only). Run it from `$env:TEMP`, never the repo — a run from the repo let its Stop hook edit a test.

## 3. Vercel switches — Production → Settings → Environment Variables, then **Redeploy**

**A. Telegram chat on Max (do now).** Steps: claude.ai → Code → Routines → *Kairos chat* → Edit → Add another trigger → API → Generate token (shown once).

| Name | Value |
|---|---|
| `KAIROS_CHAT_ROUTINE` | `1` |
| `ROUTINE_CHAT_ID` | `trig_018BYZtPKynvqtXzQ61GZdem` |
| `ROUTINE_CHAT_TOKEN` | *(token from the API trigger)* |
| `KAIROS_CHAT_ROUTINE_TIMEOUT_MS` | `120000` |

Already set: `KAIROS_DAYTIME_THINKING=1` (04/10). Paid backup is **off** (owner choice) — keep it off.

**B. Watch-only for everything else (safe now — records, changes nothing you see).**

| Name | Value |
|---|---|
| `KAIROS_STAGE` | `observe` |
| `KAIROS_COLD_READ` | `audit` |
| `KAIROS_DREAMS` | `observe` |
| `KAIROS_SURPRISE_GATE`, `KAIROS_SURPRISE_CREDIT`, `KAIROS_SURPRISE_REPLAY`, `KAIROS_CURIOSITY_LP` | `observe` |
| `KAIROS_IDEA_ATLAS`, `KAIROS_COLLISIONS`, `KAIROS_IDEA_RESAMPLE`, `KAIROS_IDEA_SHELF`, `KAIROS_IDEA_NOVELTY`, `KAIROS_IDEA_TASTE` | `observe` |
| `KAIROS_GATE`, `KAIROS_OWNER_MODEL`, `KAIROS_READINESS`, `KAIROS_BIDS`, `KAIROS_REPAIR`, `KAIROS_ASK_FIRST`, `KAIROS_TRUST`, `KAIROS_LIFE_CHAPTERS` | `observe` |

**C. Full on (after ~1 week of clean watch-only nights; check Health + the `get_kairos_*` views first).**

| Name | Value | Note |
|---|---|---|
| `KAIROS_STAGE` | `1` | |
| `KAIROS_CHARACTER_CHECK` | `1` | weekly, Mondays |
| `KAIROS_COLD_READ` | `1` | |
| `KAIROS_PREDICTIONS` | `1` | after 7 clean nights |
| `KAIROS_INITIATIVE`, `KAIROS_AGENDA` | `1` | goals, promises, Approve/Veto, Horae |
| `KAIROS_DREAMS` / `KAIROS_DREAM_LINE` | `1` / `1` | "I dreamt…" on Tue/Thu/Sat 06:00 Telegram |
| `KAIROS_SURPRISE_GATE`, `_CREDIT`, `_REPLAY`, `KAIROS_CURIOSITY_LP` | `1` | `KAIROS_SURPRISE_STAGE=1` too |
| `KAIROS_IDEA_ATLAS`, `KAIROS_COLLISIONS`, `KAIROS_IDEA_RESAMPLE`, `KAIROS_IDEA_SHELF`, `KAIROS_IDEA_NOVELTY`, `KAIROS_IDEA_TASTE` | `1` | |
| `KAIROS_IDEA_VS`, `KAIROS_IDEA_SWISS` | `1` | Swiss only once the brain reliably finishes the judge before 04:35Z |
| `KAIROS_GATE` (+ later `KAIROS_GATE_RECEPTIVITY`) | `1` | |
| `KAIROS_OWNER_MODEL` | `1` | Sunday "carrying" card; `C1 still/over/wrong` |
| `KAIROS_READINESS`, `KAIROS_BIDS`, `KAIROS_REPAIR` | `1` | bids = one emoji reaction to stickers/GIFs |
| `KAIROS_ASK_FIRST`, `KAIROS_TRUST` | `1` | trust needs ≥5 settled calls per area |
| `KAIROS_LIFE_CHAPTERS` / `KAIROS_LIFE_CHAPTER_LINE` | `1` / `1` | first chapter 1–3 Nov |
| `KAIROS_REQUIRE_ROUTINE_SCOPE` | `1` | once Telegram chat on Max is confirmed working |

**Leave off:** `KAIROS_SURPRISE_CONTRADICTIONS` (needs an explicit owner sign-off — reverses "conscience is measurement-only"). Dream seeds into ideas stay parked (revisit after 2–3 weeks of dreams in observe; only the real memories behind a lasting dream pattern, never dream text).

## 4. Open items (in order)

1. **Verify Telegram chat on Max** once §3A is in: send "hi", then `list_thinking_jobs` should show a `chat` job claimed by `routine:chat` and the reply in Telegram.
2. **Multi-user Kairos** (card in Depot; plan `research/kairos_0410/multi_user_kairos.md`): owner decision — start with BYOK + own Claude plan; Aeon-paid later. Phase 1 = one bot, `/start` linking.
3. Owner confirm → move "one coherent mind" card Landing Zone → Done.
4. Follow-ups: night-time goal proposals bypass the gate; Butcher splits (`KairosInbox.tsx` 648, `daily-message-prompt.ts` 500, ten copies of the FOR UPDATE pref mutator); Triad bridge `prompt.py` should render `today` + `stage`; REST `PUT …/checklist/:itemId` with no valid fields returns 500 (should be 400).

## 5. Traps (new today — see HANDOVER_0310 §6 for the rest)
- **Telegram stays first-class** (owner rule). Only the operator's speaks go to the one Telegram chat (#156).
- **Date time-bombs in tests:** anything comparing a fixed date to the real clock must pin the clock (`vi.useFakeTimers({ toFake: ['Date'] })` + `setSystemTime`) or take an explicit `now`.
- **Lost agent notifications:** background agents can finish without a notice — check them with `read_agent` instead of waiting.
- Aeon MCP isn't loaded in Copilot sessions; use the REST API with `AEON_API_KEY` from `apps/web/.env.local` (board: tasks `PUT` to move, checklist `state: checked`).

## 6. Start the next session with

> New Kairos/Aeon session. Read `aeon_os/HANDOVER_0410.md`. First: confirm Telegram chat runs on the Max routine (chat job claimed by `routine:chat`), and check last night's health plus which watch-only switches are set. Then start **Multi-user Kairos phase 1** (one Aeon bot, `/start` account linking, per-user Telegram routing) from `research/kairos_0410/multi_user_kairos.md` with parallel prowlers → seam/migration → executioners → warden → PR. Track on the AI Mission Control card "Kairos: multi-user — bring your own key or Claude plan".
