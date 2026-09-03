# Coding-agent session capture

**Status:** Claude Code, Codex CLI, and Copilot CLI supported
**Audience:** operators installing capture and developers adding another agent client
**Architecture:** [memory-and-capture.md](../../architecture/kairos/memory-and-capture.md)

Aeon turns a completed coding-agent session into one `session_summary` memory. The checked-in
code is reusable by every Aeon installation; hook registration and credentials are deliberately
per-user because transcripts and API keys live on the operator's machine.

## What is shared and what is personal

| Scope | Lives where | Purpose |
|---|---|---|
| Aeon capability | `apps/web/scripts/` + memory API | parsing, quality gate, metadata, deduplication, source fallback |
| Product setup UI | Kairos setup panel | copyable hook snippets for supported clients |
| Personal installation | `~/.claude`, `~/.codex`, or `~/.copilot` | invokes the checked-in dispatcher on lifecycle events |
| Personal secrets | environment or `apps/web/.env.local` | `AEON_API_KEY`; optional `AEON_BASE_URL` |

The hook path points into an Aeon checkout. Moving or deleting that checkout breaks capture until
the path is updated. A future packaged installer should remove this coupling; see **Adding another
client** below.

## Prerequisites

- An Aeon API key from **Help → MCP → API Keys**.
- `AEON_API_KEY` available to the capture process, or present in `apps/web/.env.local`.
- `AEON_BASE_URL` when Aeon is not at `http://localhost:3000`.
- Node 18+ for Claude/Codex; Node 22.13+ for Copilot's unflagged built-in SQLite reader.
- An absolute path to this repository in every hook command.

Capture always exits harmlessly after durably queueing the event. A machine-wide drain lock
serializes transcript parsing and delivery, so closing several terminals together does not spawn
several memory-heavy capture workers. Transient network, rate-limit, and server failures retry;
exhausted jobs and diagnostics remain under `~/.aeon/session-capture`.

## Install a supported client

The Kairos setup panel contains the current copyable snippets. The examples below show their
shape; replace the repository path and restart the client after editing its configuration.

### Codex CLI

Add to `~/.codex/config.toml`, then trust the hook interactively with `/hooks`:

```toml
[[hooks.SessionEnd]]
matcher = "^other$"

[[hooks.SessionEnd.hooks]]
type = "command"
command = 'node "C:/path/to/shadow_app_aeon/apps/web/scripts/codex-session-capture-dispatch.mjs"'
timeout = 3
statusMessage = "Saving session to Aeon"
```

Codex supplies its JSONL transcript path. The dispatcher durably queues it and returns quickly;
the shared drain normalises and sends queued sessions one at a time.

### Copilot CLI

Add the lifecycle hooks to `~/.copilot/config.json`:

```json
{
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "powershell": "$payload = $input | Out-String; $payload | & 'C:/Program Files/nodejs/node.exe' 'C:/path/to/shadow_app_aeon/apps/web/scripts/copilot-session-capture-dispatch.mjs'",
        "timeoutSec": 5
      }
    ],
    "sessionEnd": [
      {
        "type": "command",
        "bash": "node '/path/to/shadow_app_aeon/apps/web/scripts/copilot-session-capture-dispatch.mjs'",
        "powershell": "$payload = $input | Out-String; $payload | & 'C:/Program Files/nodejs/node.exe' 'C:/path/to/shadow_app_aeon/apps/web/scripts/copilot-session-capture-dispatch.mjs'",
        "timeoutSec": 5
      }
    ]
  }
}
```

PowerShell must explicitly forward hook stdin. `sessionEnd` performs the normal delayed capture;
`sessionStart` asynchronously retries up to five recent completed sessions without success
receipts. A receipt is written only after Aeon returns a memory id.

### Claude Code

Register `apps/web/scripts/claude-session-capture-dispatch.mjs` as a `SessionEnd` command hook in
`~/.claude/settings.json`. Claude supplies the canonical payload and transcript path directly:

```jsonc
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/path/to/shadow_app_aeon/apps/web/scripts/claude-session-capture-dispatch.mjs\"",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

For crash and force-quit recovery, register `claude-session-capture.mjs --backfill` on Claude's
`SessionStart` `startup` and `resume` matchers. It queues candidates into the same serialized
drain. Existing saved sessions with success receipts are skipped locally, and the server also
serializes identical session writes.

## Verify the installation

1. Start a disposable session in the target client with a unique marker and enough substance to
   pass the quality gate: a real answer, multiple turns, tool use, or an Executive Summary.
2. End the session normally; switching chats is not sufficient when the client reserves
   `SessionEnd` for actual termination.
3. Search Aeon for the marker and inspect the new `session_summary`.
4. Confirm `sourceMetadata.client`, `sessionId`, `repo`, `branch`, `hookEvent`, and `endReason`.
5. Re-fire the same session payload concurrently and confirm the local receipt plus the server's
   transaction lock prevent a duplicate.

If the deployed Aeon version predates a new first-class source, capture retries once as
`source='hook'` while preserving `sourceMetadata.client` and `originalSource`. That is a deployment
compatibility path, not a failed capture.

Run parser checks with:

```powershell
node apps/web/scripts/run-session-capture-tests.mjs
```

For diagnosis set `BRAIN_DEBUG=1`. Use `BRAIN_DRY_RUN=1` to print the outgoing memory without
writing it.

## Adding another client

Most work is already shared. A new client needs a lifecycle adapter and transcript reader, not a
new capture system.

1. **Probe the real client first.** Record its installed version, hook event names, stdin payload,
   transcript location/schema, exit timeout, and when the final turn becomes durable.
2. **Choose a stable client id.** Add it to memory-source validation, source filters/labels, recent
   activity, digest counts, MCP descriptions, and the setup UI.
3. **Normalise the transcript.** Produce the shared message shape: user/assistant messages plus
   `tool_use` entries with timestamps and `cwd`. Strip harness-only injected context.
4. **Write a thin dispatcher.** Reuse `session-capture-queue.mjs`; bound input size, accept the
   provider's documented payload variants, durably queue the canonical payload, and always exit 0.
5. **Reuse the shared pipeline.** `claude-session-capture.mjs` owns substance gating, git context,
   files/commits, memory payload construction, compatibility fallback, and the POST.
6. **Pin the contract with tests.** Cover valid and malformed hook payloads, transcript mapping,
   harness-noise removal, file extraction, source validation, and client + session idempotency.
7. **Prove the lifecycle, not just the parser.** Close a real disposable session and query the
   resulting Aeon memory. Include its id in the PR evidence.

### When the third new client arrives

At that point, extract the existing adapters into a registry such as
`session-adapters/<client>.mjs`, each exporting:

```text
client · normalizeHook(raw) · loadTranscript(sessionId) · persistencePolicy
```

Add an installer command such as
`node apps/web/scripts/install-session-capture-hook.mjs --client <id>`, which resolves the checkout,
writes the user-local hook config, validates it, and runs a dry smoke test. Two clients did not
justify that framework; the third one will.

## Why the first multi-client integration was slow

Live proof uncovered four provider-boundary issues beyond the ordinary code changes:

- Copilot sends lifecycle JSON on stdin; invoking Node without forwarding stdin silently drops it.
- Copilot emits `sessionEnd` before the final SQLite turn is committed.
- Codex transcripts include injected plugin, instruction, and environment messages that must not
  become the memory title.
- The live Aeon deployment initially rejected the new sources, requiring a provenance-preserving
  compatibility fallback until deployment.

The delivery also propagated sources through validation, deduplication, filters, digest/context
counts, UI labels, setup guidance, tests, live captures, review, build, deployment preview, and CI.
Future clients should be substantially faster because these contracts and failure modes are now
explicit.
