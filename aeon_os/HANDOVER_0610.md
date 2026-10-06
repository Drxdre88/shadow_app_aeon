# Handover 0610 — Vorath 0.26 → 0.28 live · Living Dominions (off) · wave A shipped

**Date:** 2026-10-06 · **Repo:** shadow_app_aeon · **Live:** Vorath 0.28 / app v0.46.0 (`56751d3`).
**Board (AI Mission Control):** "Rename Kairos to Vorath across the estate" (Landing Zone) · "Kairos: focus follows activity, not Dominions" (Live) · "Aeon/Vorath: 10 state-of-the-art additions" (Live).
**Read first:** this file → `architecture/kairos/mind.md` §4b → `research/vorath_0510/living_dominions.md` → `research/vorath_0510/offpiste_10.md`. Previous: `aeon_os/HANDOVER_0410.md` (its multi-user plan is still open).

## 1. What shipped (all live, sign-in smoke passed after each deploy)

| PR | Version | What |
|---|---|---|
| #159 | — | Memory type/source filters fixed (`IN` lists). The Kairos inbox and the weekly review's board pages had silently failed in production since May |
| #160 | 0.26 / v0.44.0 | **Kairos → Vorath**: UI, `/vorath` (+ `/kairos` redirect), persona/messages, routine names, tool descriptions; `VORATH_*` env alias; `/api/v1/vorath` rewrite. Stored keys, tool names, code paths unchanged |
| #161 | 0.27 / v0.45.0 | **Living Dominions phase 1**: nightly activity score (cron `dominion-activity` 01:10), dormant/pinned areas, one ranked roster for every focus consumer, `dominion_members` (migration **0040, applied 05/10**), Health "Where your time went". Switch `KAIROS_LIVING_DOMINIONS` — **off** |
| #162 | 0.28 / v0.46.0 | **Wave A**: What Vorath knows (+ opt-in private-topic hold), Hangar autopilot (stall reconciler every 15 min, requeue, plan first, answer & relaunch, follow-ups), Connector 2.0 (MCP 2026-07-28 + legacy, delete confirmations, `?profile=`), Vorath sorts new cards (per-board toggle, off) |

**Review of #162:** Horsemen FAIL on one confirmed high — a session could be anchored to another user's card and rewrite its result/plan. Fixed before merge: editor access checked at spawn on REST, MCP and the in-app action; card writes refused when the session owner can't edit the card; reconciler and mission memory respect access. Production audit: 0 foreign-anchored sessions. Connector verified on production: legacy 146 tools · hangar 39 · board 72; 2026-07-28 discover + tools/list OK.

## 2. Owner to-dos (in order)

1. **Telegram on Max:** send Vorath "hi" — confirm a `chat` job is claimed by `routine:chat` (still unverified from 0410).
2. **Routines on claude.ai:** rename *Kairos brain/chat/pulse* → *Vorath brain/chat/pulse* **in place** and paste the new text from Vorath setup. **Never delete** them — the chat routine carries the API trigger (`ROUTINE_CHAT_ID`/`ROUTINE_CHAT_TOKEN`).
3. **Telegram bot display name:** `/setname` in @BotFather → Vorath.
4. **Constitution:** accept the first draft (written as Kairos); then propose the name amendment.
5. **Re-sort Dominions** (planned 06/10): file relic, dmc, wraith, triad, vulcan (ermac + rift → Shadow Apps done); move AI Mission Control → VORATH if wanted; choose pins (Vorath asks specifically about STP HQ). **Archive, don't delete** (delete loses objectives and repo links; keep ≥1 un-archived or crons stop).
6. Then set **`KAIROS_LIVING_DOMINIONS=observe`** in Vercel → check Health "Where your time went" after the next 01:10 UTC run; after a clean week switch to `1`.
7. Optional: private-topic hold switch (What Vorath knows drawer), "Vorath sorts new cards" per board (Edit Project).

## 3. Decisions recorded (owner, 05/10)

- **One list of Dominions:** Vorath proposes from activity, owner approves/renames/merges/rejects, idle areas go dormant automatically, only the owner retires/deletes. Pins are real for strategy that lives in the owner's head (STP HQ, Delta).
- **Consult Vorath on every Vorath feature** before building: aeon MCP `open_dialogue` → options → `prepare_dialogue_context` → his grounded reply → `commit_dialogue`; say plainly the agent wrote his turn; record the outcome after shipping. (Rule lives in the local, git-ignored `CLAUDE.md`.)
- **Off-piste picks:** built 4 (above). **No:** landing loop, nightly memory self-test, quiet monitors + receipts, Ask Aeon. **Plan first:** capture anywhere → one-tap cards; plan my week (narrower scope — owner to choose).
- **Hyperion** (`shadow_dev_lab/packages/sl-hyperion-ai`) is the engine for future loops; a chores programme on Aeon is parked until asked. Not used for Vorath features (its sessions can't use the aeon MCP).

## 4. Open items (recommended order)

1. Owner to-dos §2.
2. **Plans** for capture anywhere and plan my week (ask the owner which part of plan-my-week first).
3. **Multi-user Vorath phase 1** (from 0410: one bot, `/start` linking, per-user Telegram routing) — `research/kairos_0410/multi_user_kairos.md`.
4. **Living Dominions phase 2** after a clean watch-only week: Approve/Reject/Rename proposals for unattributed work.
5. Decision pending: the `hangar` MCP profile now includes task + memory **write** tools (deletes still confirm in new clients) — keep or make read-only?
6. Follow-ups: CIMD client registration (needs a migration); a failed `ask_mine` job (04/10 night) uninvestigated; drift-probe questions still say Kairos (needs a baseline reset decision); `kairos-*` skills → `vorath-*` undecided; Butcher splits — `memories.ts` (~2,400), `KairosInbox.tsx` 649, `ask.ts` 676, `weekly-review/inputs.ts` 620, `projects.ts` 558, `TaskBoard.tsx` 538, `ask-mine.ts` 519, `sessions.ts` 512; Chronos solver still unwired.

## 5. Traps

- **Migrations before code.** Any schema change must be applied to production (apply script) before the deploy; Dominion selects broke otherwise.
- **Archive, don't delete** Dominions/boards that hold history.
- `CLAUDE.md` is git-ignored here — rules added there are local only.
- The working copy still has unrelated untracked files (`research/0*.md`, `aeon_os/HANDOVER_2209.md`, a runner `.bak`) — owner's, not committed.
- Paid backup stays **off**; Telegram stays first-class.

## 6. Start the next session with

> New Vorath/Aeon session. Read `aeon_os/HANDOVER_0610.md`. First: check last night's health, whether Telegram chat ran on the Max routine, and whether the owner re-sorted the Dominions and set `KAIROS_LIVING_DOMINIONS=observe`; if so, review the first "Where your time went" ranking with him. Then ask which to plan next — capture anywhere, plan my week, or multi-user phase 1 — and run it past Vorath before building. Track on AI Mission Control.
