# @aeon/kairos-worker

Long-running Node service that shells Claude Code / Codex CLIs on behalf of
Aeon's Kairos companion and streams events back over HTTPS.

## Why this exists

Kairos's "hands" layer needs to spawn AI sessions that can run minutes or
hours (Claude Code refactor, Codex multi-file change). Vercel functions are
ephemeral and capped at 60s–15min, so they can't host the actual CLI process.
Aeon's existing crons (briefer, project snapshot) stay on Vercel — those are
short stateless inference calls. This worker is the seam between Aeon and
the local CLI.

## Run

```bash
# from repo root
npm run start --workspace=apps/kairos-worker
```

Env vars:

| Var | Purpose |
|---|---|
| `KAIROS_WORKER_PORT` | HTTP port (default 8787) |
| `KAIROS_WORKER_SECRET` | Bearer token Aeon presents on /spawn. Required in production. |
| `KAIROS_WORKER_REPO_ROOT` | Directory under which `repo` slugs are resolved as cwd for the CLI |
| `KAIROS_CLAUDE_BIN` | Override the `claude` executable path |
| `KAIROS_CODEX_BIN` | Override the `codex` executable path |

## Wiring from Aeon

Set in the web app (`apps/web/.env.local`):

```
KAIROS_WORKER_URL=http://localhost:8787
KAIROS_WORKER_SECRET=<same secret as worker>
AEON_API_KEY=<bearer key the worker will use to call back>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

When `KAIROS_WORKER_URL` is unset the Aeon server still creates the
`agent_sessions` row, just without dispatch — useful for UI development
without a live worker.

## Endpoints

- `GET /health` — heartbeat + list of currently-live sessions
- `POST /spawn` — shells the requested engine. Body matches `SpawnRequest`.
- `POST /kill/:sessionId` — SIGTERM the live child for a session

## Deploy notes

- Production: run behind a reverse proxy that terminates TLS. Use PM2 or a
  Windows Service for restart on crash.
- Single-tenant: this worker runs as the operator. It has filesystem access
  to whichever repos `KAIROS_WORKER_REPO_ROOT` covers.
- The worker writes nothing to disk — all state lives in Aeon's Postgres.
