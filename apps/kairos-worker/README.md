# @aeon/kairos-worker

Long-running Node service that shells Claude Code / Copilot CLI / Codex on
behalf of Aeon and streams events back over HTTPS.

Two dispatch modes share one process:

| Mode | Who initiates | Used by |
|---|---|---|
| **push** (default) | Aeon POSTs `/spawn` at this worker | Kairos "hands" |
| **poll** | worker claims queued sessions from Aeon | AI Hangar agent missions |

`KAIROS_MODE=both` runs them together. Push behaviour is unchanged by the
poll work — the two paths only share the transport and the child-process
plumbing.

## Why this exists

Kairos's "hands" layer needs to spawn AI sessions that can run minutes or
hours (Claude Code refactor, Codex multi-file change). Vercel functions are
ephemeral and capped at 60s–15min, so they can't host the actual CLI process.
Aeon's existing crons (briefer, project snapshot) stay on Vercel — those are
short stateless inference calls. This worker is the seam between Aeon and
the local CLI.

Poll mode additionally inverts the direction of dispatch: nothing has to
reach this host, so the runner works behind NAT/corp networks with no tunnel.

## Run

```bash
# from repo root
npm run start --workspace=apps/kairos-worker          # push mode
KAIROS_MODE=poll npm run start --workspace=apps/kairos-worker
```

### Env vars

| Var | Mode | Default | Purpose |
|---|---|---|---|
| `KAIROS_MODE` | both | `push` | `push` \| `poll` \| `both` |
| `KAIROS_WORKER_PORT` | both | `8787` | HTTP port (health/spawn/kill) |
| `KAIROS_WORKER_SECRET` | push | — | Bearer token Aeon presents on `/spawn`. Required in production. |
| `KAIROS_WORKER_REPO_ROOT` | push | `process.cwd()` | Directory under which push-mode `repo` slugs resolve |
| `AEON_BASE_URL` | poll | `http://localhost:3000` | Aeon origin the poller claims from |
| `KAIROS_AEON_API_KEY` | poll | — | `aeon_k1_` key used as Bearer for claim/events/heartbeat. Poll mode is disabled without it. |
| `AEON_API_KEY` | poll | — | Legacy fallback for the above, warned about at startup. **In the web app this same name is the server master key** (admin scope, rate-limit bypass) — a shared `.env` would silently promote the runner to admin, so prefer `KAIROS_AEON_API_KEY`. |
| `KAIROS_POLL_INTERVAL_MS` | poll | `15000` | Delay between claim attempts (recursive timeout, never overlapping) |
| `KAIROS_MAX_CONCURRENT` | poll | `1` | Live poll-mode sessions allowed. Keep at 1 — two missions would share one checkout. |
| `KAIROS_HEARTBEAT_MS` | poll | `30000` | Heartbeat + cooperative-kill check interval |
| `KAIROS_REPOS_FILE` | poll | `apps/kairos-worker/repos.local.yaml` | Host-local slug → path registry |
| `KAIROS_CLAUDE_BIN` | both | `claude` | Override the `claude` executable |
| `KAIROS_CODEX_BIN` | both | `codex` | Override the `codex` executable |
| `KAIROS_COPILOT_BIN` | both | `copilot` | Override the `copilot` executable |
| `KAIROS_CLAUDE_DEFAULT_MODEL` | poll | — | Model when the card names none |
| `KAIROS_COPILOT_DEFAULT_MODEL` | poll | `claude-opus-5` | Model when the card names none — **verify the slug**, see below |
| `KAIROS_CODEX_DEFAULT_MODEL` | poll | — | Model when the card names none |

> **Confirm the Copilot model slug once per host** before the POC:
> `copilot -p "reply OK" --model claude-opus-5 --allow-all-tools --no-ask-user`
> If Copilot's picker names Opus 5 differently, set `KAIROS_COPILOT_DEFAULT_MODEL`.

## Poll mode (AI Hangar)

1. Every `KAIROS_POLL_INTERVAL_MS`, POST `/api/v1/sessions/claim` with
   `{ workerId, engines: ['claude','copilot','codex'] }`. Empty queue → idle.
2. Resolve `session.repo` through `repos.local.yaml`. An unknown slug is not
   fatal to the worker: it posts an `error` event, fails the session, and the
   loop continues. Branch / model / session id are held to
   `^[A-Za-z0-9._:/@-]+$` before they reach any argv.
3. `git status --porcelain` — **a dirty checkout refuses the mission** rather
   than sweeping the operator's uncommitted work onto the mission branch. Then
   `git fetch origin` (best effort) → `git checkout -b aeon/<taskId-8> origin/<defaultBranch>`,
   reusing the branch if it already exists.
4. Write the dispatch prompt to a temp **mission brief** file and spawn the
   engine with a one-line pointer to it (see below); stdout is coalesced into
   ~2s batches (or 6KB, whichever comes first) and streamed to the session
   timeline as `message` events, stderr as `error` events.
5. Heartbeat every `KAIROS_HEARTBEAT_MS`; the same tick reads the session back
   and SIGTERMs the child if Aeon flipped it to `killed` (or if the claim was
   taken over — heartbeat 404).
6. On child `close` (not `exit` — stdio is still draining then, and the
   envelope usually rides in the last chunk): post `stop`, extract the **last
   fenced ```json block** as the result envelope, post it as a `result` event,
   PATCH the final status, and `git checkout <defaultBranch>`. The `aeon/*`
   branch is never deleted. Those last two writes retry (5s/15s/45s) so Aeon's
   60 writes/min limit can't strand a finished mission on `running`.

No envelope found → a synthetic `result` event with
`status:'failed', outcome:'blocked'` plus the last 2000 chars of output, and
the session fails regardless of exit code.

### Registry

```bash
cp repos.local.yaml.example repos.local.yaml   # gitignored, host-specific
```

The worker also writes `.worker-id` next to it (a stable random suffix) so its
`workerId` — `<hostname>-<suffix>` — survives restarts.

### Engine command lines

| engine | command |
|---|---|
| `claude` | `claude -p "<dispatch>" --output-format stream-json --verbose --permission-mode acceptEdits [--model M]` |
| `copilot` | `copilot -p "<dispatch>" --allow-all-tools --no-ask-user --output-format json [--model M]` |
| `codex` | `codex exec "<dispatch>" --json -o <tmp> -s workspace-write -C <repo> [-m M]` |

Binaries are resolved once at first use: a real `.exe` on `PATH` is spawned
**without a shell**, so argv reaches the child untouched and nothing parses it
on the way. Only a `.cmd`/`.bat` shim (`codex` ships one) falls back to
`cmd.exe`, and that path escapes argv for both parsers — CRT quoting first,
then a caret in front of every cmd metacharacter.

`<dispatch>` is not the full prompt. A `cmd.exe` command line cannot contain
newlines and caps out near 8k characters, while a card instruction may be 20k.
So the mission text is written to
`%TEMP%/aeon-hangar-<sessionId>-brief.md` and argv carries a single-line
pointer at it; the engine reads the file as its first act. The brief is
deleted when the session ends.

`--verbose` is mandatory for Claude: `-p` with `--output-format stream-json`
exits immediately without it. Claude/Copilot emit JSON-wrapped prose, so the
envelope scanner decodes those streams before looking for the fenced block;
Codex's envelope is read from its `-o` file first.

Killing a session runs `taskkill /T /F` on Windows. `SIGTERM` alone ends a
`cmd.exe` shim and leaves the engine running (verified 2026-08-20), which
would let a "killed" agent keep editing the repo.

## Wiring from Aeon

Set in the web app (`apps/web/.env.local`):

```
KAIROS_WORKER_URL=http://localhost:8787
KAIROS_WORKER_SECRET=<same secret as worker>
AEON_API_KEY=<push-mode callback token the server hands the worker (server master key)>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

When `KAIROS_WORKER_URL` is unset the Aeon server still creates the
`agent_sessions` row, just without dispatch — which is exactly the queue that
poll mode drains.

## Endpoints

- `GET /health` — `{ ok, mode, lastPollAt, workerId, live }`
- `POST /spawn` — shells the requested engine. Body matches `SpawnRequest`.
- `POST /kill/:sessionId` — SIGTERM the live child for a session

## Deploy notes

- Production: run behind a reverse proxy that terminates TLS. Use PM2 or a
  Windows Service for restart on crash. Poll mode needs no inbound reachability.
- Single-tenant: this worker runs as the operator. It has filesystem access
  to whichever repos the registry (or `KAIROS_WORKER_REPO_ROOT`) covers, and
  its `KAIROS_AEON_API_KEY` is unscoped.
- The only files it writes are `.worker-id` and the temp file Codex reports
  through — all session state lives in Aeon's Postgres.
