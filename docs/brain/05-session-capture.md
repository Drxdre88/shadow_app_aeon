# Aeon Brain — Phase 2: Claude Session Capture

**Status:** drafted 2026-05-13
**Depends on:** Phase 1 substrate (the `memories` table + `/api/v1/memories` endpoint)

The brain only becomes useful when it fills itself. Phase 2 installs a single global hook that captures every Claude Code session you finish — across every repo — into your brain.

---

## What it does

When a Claude session ends, the hook:

1. Reads the session transcript JSONL Claude maintains
2. Runs a quality gate (skip "what's 2+2" sessions)
3. Extracts the git context (repo, branch, remote)
4. Collects files touched (from `Edit`/`Write`/`MultiEdit`/`NotebookEdit` tool calls)
5. Collects commits made during the session window
6. POSTs a structured `session_summary` memory to `/api/v1/memories`

Everything is fire-and-forget with an 8-second timeout. The hook **always exits 0** — a brain capture failure can never block your session ending.

---

## Prerequisites

| | |
|---|---|
| Node | ≥ 18 (uses built-in `fetch`) |
| Aeon `.env.local` | The script auto-loads `apps/web/.env.local` — `AEON_API_KEY` must be set there (it is by default for any aeon dev setup) |
| Aeon reachable | Either dev server running on `localhost:3000`, or override `AEON_BASE_URL` |
| Migration applied | The `memories` table exists in your DB (see `01-schema.md`) |

---

## 1. Env (probably already done)

The hook reads `apps/web/.env.local` **automatically** — relative to the script's own path. You don't need to export anything in your shell profile.

The script looks for these keys in `.env.local`:

| Key | Required | Default |
|---|---|---|
| `AEON_API_KEY` | yes | — |
| `AEON_BASE_URL` | no | `http://localhost:3000` |
| `BRAIN_DEFAULT_REALM_ID` | no | `null` (memory floats free) |

If you want to override at hook-fire time (e.g., point at prod), you can still set them as real shell env vars — shell env wins over `.env.local`.

Optional debug flags (one-off via shell):

```bash
BRAIN_DEBUG=1    # verbose stderr from the hook
BRAIN_DRY_RUN=1  # print payload, skip the POST
```

---

## 2. Register the hook in `~/.claude/settings.json`

Add a `SessionEnd` entry pointing at the script. Use the **absolute path** to the script in this repo.

```jsonc
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon/apps/web/scripts/claude-session-capture.mjs\"",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}
```

**POSIX path equivalent:**

```jsonc
{
  "type": "command",
  "command": "node /home/you/projects/shadow_app_aeon/apps/web/scripts/claude-session-capture.mjs",
  "timeout": 15000
}
```

> **Why `SessionEnd` not `Stop`?** `Stop` fires after every agent turn — too noisy. `SessionEnd` fires once when the session terminates (`/exit`, terminal close, etc.) and captures the whole arc.

If you already have a `SessionEnd` block in your settings, append this hook entry to the existing `hooks` array — multiple hooks can run on the same event.

---

## 3. Test it (no risk to real brain)

The script supports a dry-run mode that skips the POST and prints the payload it *would* send.

```bash
# Build a minimal fake hook payload pointing at any real transcript
TRANSCRIPT=$(ls ~/.claude/projects/*/sessions/*.jsonl 2>/dev/null | head -1)

echo "{
  \"session_id\": \"test-$(date +%s)\",
  \"transcript_path\": \"$TRANSCRIPT\",
  \"cwd\": \"$(pwd)\",
  \"hook_event_name\": \"SessionEnd\",
  \"reason\": \"prompt_input_exit\"
}" | BRAIN_DRY_RUN=1 BRAIN_DEBUG=1 node apps/web/scripts/claude-session-capture.mjs
```

You should see the full memory payload printed to stderr, with title, body, sourceMetadata, and tags filled in.

To do a **real** test (writes to your live brain):

```bash
# Drop BRAIN_DRY_RUN; start the dev server first or point at prod.
echo "..." | BRAIN_DEBUG=1 node apps/web/scripts/claude-session-capture.mjs
```

Then verify in Aeon:

```bash
curl -s "$AEON_BASE_URL/api/v1/memories?type=session_summary&limit=5" \
  -H "Authorization: Bearer $AEON_API_KEY" | jq '.data[] | {title, createdAt}'
```

---

## 4. Tuning the quality gate

The hook skips sessions where `userTurns < 3` AND `toolUses < 2`. This filters out short Q&As that aren't worth remembering. Override via env:

```bash
export BRAIN_MIN_USER_TURNS=3   # default
export BRAIN_MIN_TOOL_USES=2    # default
```

Set both to `0` to capture every session including drive-by chats.

---

## 5. What gets stored

Each memory created by the hook:

| Field | Value |
|---|---|
| `title` | `<repo>: <first 60 chars of first user prompt>` |
| `bodyMd` | Markdown with sections: Session stats, First user prompt, Files touched, Commits, Final assistant excerpt |
| `summary` | First user prompt, truncated to 240 chars |
| `type` | `session_summary` |
| `source` | `claude` |
| `realmId` | `BRAIN_DEFAULT_REALM_ID` if set, else null |
| `sourceMetadata` | `{ repo, branch, remote, sessionId, cwd, hookEvent, endReason, filesTouched[], commits[], stats: { userTurns, toolUses, durationMin, messageCount } }` |
| `tags` | `['session', '<repo>', 'branch:<non-default-branch>']` |

---

## 6. Querying the captured brain

Once the hook has been firing for a few days, the brain becomes useful via MCP:

```
search_memories({ query: "RAG bifurcation", type: "session_summary" })
search_memories({ query: "auth refactor", realmId: "<AEON Dev>" })
get_memory_with_neighbours({ memoryId: "<id>", hops: 2 })
```

In Phase 4, the dedicated `prepare_context()` MCP tool will turn this into a single "what do I know about X?" call ready for any Claude conversation.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `AEON_API_KEY not set` in stderr | env var not exported in the shell Claude runs in | Set in your *shell profile*, not just a one-off `export` |
| `POST failed 401` | API key wrong or revoked | Re-issue via UI or check `.env.local` |
| `POST failed 400 Realm not accessible` | `BRAIN_DEFAULT_REALM_ID` points at a realm you don't own | Use one of your realm UUIDs |
| `POST error: fetch failed` | Dev server not running and `AEON_BASE_URL` still localhost | Start the server OR point at prod |
| No memory shows up but no errors | Quality gate filtered it | Lower thresholds or set both to 0 |
| Hook runs but takes forever | Slow Neon connection on first POST | First-request cold start; subsequent fire in <500ms |

Run with `BRAIN_DEBUG=1` to see the full decision trace.

---

## 8. Phase 2.5 wishlist (not in this drop)

- **Claude-summarised body.** Currently the body is mechanically assembled from the transcript. A future variant calls `claude --print "summarise in 5 bullets"` against the transcript for a denser, narrative body. Costs a fast model call per session; opt-in via `BRAIN_USE_CLAUDE_SUMMARY=1`.
- **Realm auto-detection.** Read a `.aeonrc` file from the repo root specifying `realmId` so each repo lands in the right realm automatically. Falls back to `BRAIN_DEFAULT_REALM_ID`.
- **Tag inference.** Detect technologies (`typescript`, `python`, `react`) from `filesTouched` extensions and add as tags.
- **Skip on private-repo opt-out.** A `.aeonrc` with `"capture": false` disables capture for that repo entirely.

All three are 30-minute follow-ups once Phase 2 is proven valuable.
