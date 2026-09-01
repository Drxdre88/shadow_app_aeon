// Codex session discovery, for backfill.
//
// Codex writes one JSONL rollout per session under
//   $CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<sessionId>.jsonl
// and the SessionEnd hook is the only thing that ever asked Aeon to capture
// one. A session that dies without a clean end — a crash, a kill, a closed
// terminal, or simply an end reason the hook matcher did not match — was never
// captured and had no second chance. Claude and Copilot both have a backfill
// pass; Codex did not, and the disk showed it: 117 rollouts, 1 receipt.
//
// This module only FINDS sessions. Parsing them is already handled by
// normalizeTranscript() in session-transcript.mjs, which recognises a rollout
// by its response_item / session_meta / turn_context records, so the capture
// path needs nothing new — just a transcript_path pointed at the file.

import { readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// rollout-2026-09-01T07-56-44-01a05bc1-8469-7fa2-9ea0-3fdd61f6b43f.jsonl
// The timestamp uses '-' as its time separator too, so anchoring on the fixed
// date-time shape is what keeps the trailing capture group the session id.
const ROLLOUT_FILE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$/

// A rollout's first line is session_meta, and it carries the full system
// prompt — tens of KB. Read a bounded head rather than the whole file.
const CWD_PROBE_BYTES = 256 * 1024

const MAX_WALK_DEPTH = 4

export function resolveCodexSessionsRoot() {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
}

export function parseCodexRolloutSessionId(filename) {
  if (typeof filename !== 'string') return null
  const match = ROLLOUT_FILE.exec(filename)
  return match ? match[1] : null
}

/**
 * Pull `cwd` out of a rollout's session_meta record without reading the whole
 * file. Returns null on anything unexpected — cwd only enriches the capture
 * with repo/branch, so a miss must never cost us the session itself.
 */
export function readCodexSessionCwd(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.allocUnsafe(CWD_PROBE_BYTES)
    const read = readSync(fd, buffer, 0, CWD_PROBE_BYTES, 0)
    const head = buffer.toString('utf8', 0, read)
    const newline = head.indexOf('\n')
    // No newline in the probe means the first record is larger than the probe
    // window; treat cwd as unknown rather than parsing a truncated line.
    if (newline === -1) return null
    const record = JSON.parse(head.slice(0, newline))
    const cwd = record?.payload?.cwd
    return typeof cwd === 'string' && cwd ? cwd : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch {}
    }
  }
}

function walk(dir, depth, out) {
  if (depth > MAX_WALK_DEPTH) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, depth + 1, out)
      continue
    }
    const sessionId = parseCodexRolloutSessionId(entry.name)
    if (!sessionId) continue
    let stat
    try { stat = statSync(full) } catch { continue }
    if (!stat.isFile() || stat.size === 0) continue
    out.push({ id: sessionId, path: full, mtime: stat.mtimeMs })
  }
}

/**
 * Rollouts worth backfilling, newest first.
 *
 * `currentSessionId` is excluded because the session that just started has not
 * produced anything yet — capturing it would file an empty memory and burn its
 * receipt, so the real content would never be captured later.
 *
 * Receipts are NOT checked here; the caller does that, so this stays a pure
 * filesystem read that tests can drive against a fixture directory.
 */
export function listCodexBackfillSessions(currentSessionId, options = {}) {
  const {
    root = resolveCodexSessionsRoot(),
    hoursWindow = Number.parseInt(process.env.BRAIN_BACKFILL_HOURS ?? '48', 10) || 48,
    scanLimit = 100,
    now = Date.now(),
  } = options

  const found = []
  walk(root, 0, found)

  const minMtime = now - hoursWindow * 60 * 60 * 1000
  return found
    .filter((session) => session.id !== currentSessionId && session.mtime >= minMtime)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, scanLimit)
}
