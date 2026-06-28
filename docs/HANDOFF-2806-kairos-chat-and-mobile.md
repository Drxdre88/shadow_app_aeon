# Handoff — Kairos chat overhaul · mobile app · memory-hook fix (2026-06-27)

One place to resume after a few days away. Detail lives in the new [`architecture/`](../architecture/)
folder; this is the "where we got to + what's next" map.

## 1. Memory-capture hook — DONE (not yet committed)

The Claude session-capture pipeline was filling the brain with dirty memories. Fixed:
- `apps/web/scripts/claude-session-capture.mjs` — child-session guard (the summariser's own
  `claude -p` no longer captures itself), stronger substance gate (drops stubs, keeps design
  sessions), deterministic in-hook `aiTitle` + `execSummary`.
- `~/.claude/hooks/summarise-memories/{summarise.ps1,prompt.md}` — recursion guard + drains the
  backlog (batch 12, looped) instead of 3-at-a-time.
- Validated with three fixtures (automated / stub / real). Detail: [architecture/kairos/memory-and-capture.md](../architecture/kairos/memory-and-capture.md) §3.
- **Status:** working, uncommitted. The two `~/.claude/` files are global (outside this repo);
  the repo change is the one `.mjs` script.

## 2. Mobile app — login slice SCAFFOLDED (needs your setup to run)

New Expo app at `apps/mobile/` (SDK 53 / RN 0.79 / React 19), v1 = Kairos chat. The Google login
is built end to end in code and the **server side already existed** (`/api/v1/auth/mobile/google`).
Detail + the full setup checklist: [architecture/mobile.md](../architecture/mobile.md).

**To make it run (operator-only, ~20 min):**
1. Google Cloud Console (same project as the web client): create an **iOS** OAuth client (Bundle ID
   `app.aeon.mobile`); Android too if you'll test on Android (package + SHA-1). The **web** client
   ID must equal the server's `AUTH_GOOGLE_ID`.
2. Fill `apps/mobile/.env` + the `iosUrlScheme` in `apps/mobile/app.json`.
3. Add your email to `ALLOWED_EMAILS` on the web server if that allowlist is set.
4. `cd apps/mobile && npm install && npx expo install --fix && npx expo run:ios` (one-time dev build
   — native Google sign-in can't run in plain Expo Go).

## 3. Kairos chat — DESIGNED, not built (the next big piece)

The reframe: you talk to **Kairos** (the entity); he activates **Aether** (his super-brain) for
global retrieval across all Dominions + smart write-routing that auto-files takeaways to the right
Dominion (with a "filed under X" note). Drops the current one-Dominion-per-thread Visor constraint.
Reuses the existing BYOK LLM + retrieval + streaming provider; the new work is a **REST + streaming
exposure** of the chat engine (today it's a server action, unreachable from React Native), the
agentic retrieval tools, and the routing step. Decisions + plan:
[architecture/kairos/chat.md](../architecture/kairos/chat.md) → "PLANNED — Aether-level mobile chat".
Resume order: build the server-side Aether chat REST/stream endpoint → then the mobile chat screen.

## 4. Docs restructure — DONE

`ARCHITECTURE.md` is now a router; detail is split into [`architecture/`](../architecture/) (Swarm
convention) and refreshed to current code. `CLAUDE.md` updated to point at it.

## Loose ends / cleanup candidates (not actioned — your call)

- Commit the memory-hook fix + the `apps/mobile/` scaffold + this docs restructure.
- `HANDOVER-oauth-noresponse-bug.md` (root) is now superseded by `architecture/history.md` — safe to delete when you're ready.
- `VISION.md` had uncommitted edits at session start — left untouched.
