# Kairos Session Hook — Install

The Kairos worker spawns `claude` (or `codex`) sessions on the operator's
behalf. Claude Code's PostToolUse and Stop hooks call back into Aeon so the
live session orbs in the Kairos graph stay current and a session-summary
memory lands at termination.

The hook only fires for Kairos-spawned sessions. For sessions you start
manually (running `claude` yourself), the env vars it checks are absent and
the hook exits immediately — it cannot affect non-Kairos work.

## Install

Add the following block to `~/.claude/settings.json` (create the file if
it doesn't exist). Replace the absolute path with the path to this repo on
your machine.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:\\\\Users\\\\<you>\\\\data_science\\\\dev_26\\\\shadow_app_aeon\\\\apps\\\\web\\\\scripts\\\\kairos-session-hook.mjs\" PostToolUse"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:\\\\Users\\\\<you>\\\\data_science\\\\dev_26\\\\shadow_app_aeon\\\\apps\\\\web\\\\scripts\\\\kairos-session-hook.mjs\" Stop"
          }
        ]
      }
    ]
  }
}
```

On macOS / Linux:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/<you>/code/shadow_app_aeon/apps/web/scripts/kairos-session-hook.mjs PostToolUse"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/<you>/code/shadow_app_aeon/apps/web/scripts/kairos-session-hook.mjs Stop"
          }
        ]
      }
    ]
  }
}
```

## How it knows which session is which

The kairos-worker injects three env vars when it spawns the CLI:

- `KAIROS_SESSION_ID` — the agent_sessions row id
- `KAIROS_CALLBACK_URL` — Aeon base URL the hook posts to
- `KAIROS_CALLBACK_TOKEN` — Bearer token used by the hook

If any of these are missing, the hook is a no-op. So enabling the hook is
safe for normal Claude usage.

## Verify

1. Start the worker: `npm run start --workspace=apps/kairos-worker`
2. From Aeon (UI or MCP), spawn a session: `spawn_session({ engine: 'claude', goal: 'test', prompt: 'list files' })`
3. The session should appear in /kairos with status `running`.
4. As the spawned CLI runs, `session_events` rows accumulate — visible in
   the live transcript panel.
5. When the CLI exits, the session's status flips to `succeeded` / `failed`
   and a session-summary memory is created (when implemented).
