#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Aeon Brain — coding-agent SessionEnd capture hook.
//
// Reads the hook payload from stdin (JSON: { session_id, transcript_path,
// cwd, hook_event_name, reason }), parses the transcript JSONL, and POSTs
// a structured summary to /api/v1/memories as type=session_summary,
// source matching the originating coding agent.
//
// Cross-platform: pure Node 18+ (built-in fetch, no extra deps).
// Fail-safe: ALWAYS exits 0 so a failure here can never block your session.
// Errors go to stderr (visible in Claude's hook log) but never propagate.
//
// Required env: AEON_API_KEY
// Optional env: AEON_BASE_URL          (default http://localhost:3000)
//               BRAIN_DEFAULT_REALM_ID (optional default realm anchor)
//               BRAIN_DEBUG=1          (print verbose stderr)
//               BRAIN_DRY_RUN=1        (skip the POST, print payload only)
//               BRAIN_MIN_USER_TURNS   (default 3)
//               BRAIN_MIN_TOOL_USES    (default 2)
//               BRAIN_AI_CLEANUP=1     (call `claude --print` to generate
//                                      aiTitle + execSummary before posting.
//                                      Off by default. Adds 5–15s latency)
//               BRAIN_AI_CLEANUP_BIN   (path to claude binary, default: `claude`)
//               BRAIN_AI_CLEANUP_TIMEOUT_MS (default 60000)
//
// Install: see docs/brain/05-session-capture.md
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { normalizeTranscript } from './session-transcript.mjs'
import { truncate, deriveAiTitle } from './session-title.mjs'
import { enqueueCapture, startCaptureDrain } from './session-capture-queue.mjs'

// ─── helpers ────────────────────────────────────────────────────────────

// Auto-load .env.local from this repo so the user doesn't need to export
// anything in their shell profile. AEON_API_KEY + AEON_API_USER_ID + (optional)
// AEON_BASE_URL + BRAIN_DEFAULT_REALM_ID are all read from there.
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  const envSrc = readFileSync(envPath, 'utf8').replace(/\r/g, '')
  for (const rawLine of envSrc.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

const DEBUG = process.env.BRAIN_DEBUG === '1'
const DRY_RUN = process.env.BRAIN_DRY_RUN === '1'
const MIN_USER_TURNS = parseInt(process.env.BRAIN_MIN_USER_TURNS ?? '3', 10)
const MIN_TOOL_USES = parseInt(process.env.BRAIN_MIN_TOOL_USES ?? '2', 10)
const BASE_URL = (process.env.AEON_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const API_KEY = process.env.AEON_API_KEY
const DEFAULT_REALM_ID = process.env.BRAIN_DEFAULT_REALM_ID || null
const AI_CLEANUP = process.env.BRAIN_AI_CLEANUP === '1'
const AI_CLEANUP_BIN = process.env.BRAIN_AI_CLEANUP_BIN || 'claude'
const AI_CLEANUP_TIMEOUT_MS = parseInt(process.env.BRAIN_AI_CLEANUP_TIMEOUT_MS ?? '60000', 10)

const log = (...args) => DEBUG && console.error('[brain-capture]', ...args)
const warn = (...args) => console.error('[brain-capture]', ...args)

function bail(reason) {
  log('skip:', reason)
  process.exit(0)
}

// ─── repo → Aeon project resolution ─────────────────────────────────────
// Convention agreed with the user (May 2026):
//   shadow_app_X            → "X APP"            (uppercase last word)
//   <name>_dash             → "<NAME UPPERCASE> APP"
//   *_lab (snake)           → "<Title-Cased> Lab"  ("ml" stays uppercase)
// Anything outside the convention returns null and the session still gets
// tagged with the repo slug but anchors to no Aeon project.
function repoToProjectName(slug) {
  if (!slug) return null
  const s = String(slug).trim()
  const appMatch = s.match(/^shadow_app_(.+)$/)
  if (appMatch) return appMatch[1].toUpperCase() + ' APP'
  if (s.endsWith('_dash')) {
    return s.slice(0, -5).toUpperCase().replace(/_/g, ' ') + ' APP'
  }
  if (s.endsWith('_lab')) {
    return s
      .split('_')
      .map((w) =>
        w.toLowerCase() === 'ml'
          ? 'ML'
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      )
      .join(' ')
  }
  return null
}

// Derive the repo slug from cwd by walking up to the dev_26 root.
function repoSlugFromCwd(cwd) {
  if (!cwd) return null
  const norm = normalizeCwd(cwd).replace(/\\/g, '/')
  const m = norm.match(/\/dev_26\/([^/]+)/)
  return m ? m[1] : basename(norm) || null
}

const projectCache = new Map() // projectName → { id, realmId, realmName } | null
async function resolveProject(projectName) {
  if (!projectName) return null
  if (projectCache.has(projectName)) return projectCache.get(projectName)
  const url = `${BASE_URL}/api/v1/projects/resolve?name=${encodeURIComponent(projectName)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      log(`resolveProject(${projectName}) → ${res.status}`)
      projectCache.set(projectName, null)
      return null
    }
    const parsed = await res.json()
    const data = parsed?.data ?? null
    projectCache.set(projectName, data)
    return data
  } catch (err) {
    log(`resolveProject(${projectName}) error: ${err.message}`)
    projectCache.set(projectName, null)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeCwd(cwd) {
  if (!cwd) return cwd
  // Convert Git Bash / WSL style `/c/Users/...` to `C:/Users/...` on Windows.
  if (process.platform === 'win32') {
    const m = cwd.match(/^\/([a-zA-Z])\/(.*)$/)
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`
  }
  return cwd
}

function gitCmd(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd: normalizeCwd(cwd),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim()
  } catch {
    return null
  }
}

function readStdin() {
  try {
    const payloadArgIndex = process.argv.indexOf('--hook-payload-base64')
    const buf = payloadArgIndex >= 0 && process.argv[payloadArgIndex + 1]
      ? Buffer.from(process.argv[payloadArgIndex + 1], 'base64').toString('utf8')
      : readFileSync(0, 'utf8')
    return JSON.parse(buf)
  } catch (err) {
    bail(`stdin parse failed: ${err.message}`)
  }
}

// ─── transcript parsing ─────────────────────────────────────────────────

function parseTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  const raw = readFileSync(transcriptPath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const messages = []
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch {
      // Skip malformed lines silently — transcripts can have partial writes.
    }
  }
  return messages
}

// Strip noise injected by the harness before it reaches the user's real prompt.
function sanitizeCapturedText(s) {
  if (!s) return ''
  let out = s
  // Remove <system-reminder>...</system-reminder> blocks (multiline, case-insensitive).
  out = out.replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, '')
  // Remove known command-wrapper tags and their content.
  const cmdTags = ['command-name', 'command-message', 'command-args', 'local-command-stdout']
  for (const tag of cmdTags) {
    // Paired tags with content.
    out = out.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
    // Self-closing or lone opening/closing tags.
    out = out.replace(new RegExp(`<\\/?${tag}[^>]*>`, 'gi'), '')
  }
  // Remove pasted tool-output lines (trimmed form starts with ⎿).
  out = out
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('⎿'))
    .join('\n')
  // Collapse 3+ consecutive blank lines to 2.
  out = out.replace(/(\n\s*){3,}/g, '\n\n').trim()
  return out
}

function extractFirstUserMessage(messages) {
  for (const m of messages) {
    if (m.type !== 'user') continue
    const content = m.message?.content
    let raw = null
    if (typeof content === 'string') {
      raw = content
    } else if (Array.isArray(content)) {
      raw = content.find((c) => c?.type === 'text')?.text ?? null
    }
    if (raw == null) continue
    const cleaned = sanitizeCapturedText(raw)
    if (cleaned.trim()) return cleaned
  }
  return null
}

function extractLastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'assistant') continue
    const content = m.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const text = content
        .filter((c) => c?.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return null
}

function extractFilesTouched(messages) {
  const files = new Set()
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const content = m.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type !== 'tool_use') continue
      const name = c.name
      const input = c.input || {}
      if (Array.isArray(input.file_paths)) {
        for (const filePath of input.file_paths) {
          if (typeof filePath === 'string' && filePath) files.add(filePath)
        }
      }
      // Edit, Write, NotebookEdit, MultiEdit all carry a file_path
      if ((name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') && typeof input.file_path === 'string') {
        files.add(input.file_path)
      }
    }
  }
  return [...files]
}

function countSignals(messages) {
  let userTurns = 0
  let toolUses = 0
  let userTextChars = 0
  for (const m of messages) {
    if (m.type === 'user') {
      // Filter out tool_result pseudo-users (system-generated responses).
      const c = m.message?.content
      if (typeof c === 'string') {
        userTurns++
        userTextChars += sanitizeCapturedText(c).length
      } else if (Array.isArray(c) && c.some((p) => p?.type === 'text')) {
        userTurns++
        for (const p of c) if (p?.type === 'text') userTextChars += sanitizeCapturedText(p.text || '').length
      }
    }
    if (m.type === 'assistant') {
      const c = m.message?.content
      if (Array.isArray(c)) {
        for (const p of c) if (p?.type === 'tool_use') toolUses++
      }
    }
  }
  return { userTurns, toolUses, userTextChars }
}

// ─── automation / stub filtration ───────────────────────────────────────
// Sessions spawned BY our own hooks (the async summariser's `claude -p`, the
// optional AI-cleanup `claude --print`) would otherwise be captured as junk
// "memories about summarising memories". The primary guard is the
// AEON_HOOK_CHILD env var set when we spawn those children; this text-sentinel
// pass is the backfill-path backstop (old meta transcripts carry no env).
const AUTOMATION_SENTINELS = [
  'drain the aeon memory summary backlog',
  'summarising a claude code session for a personal memory layer',
  'you are running headless to drain',
]

function isAutomatedSession(messages) {
  const first = (extractFirstUserMessage(messages) || '').toLowerCase()
  if (!first) return false
  return AUTOMATION_SENTINELS.some((s) => first.includes(s))
}

function sessionDurationMin(messages) {
  // Scan for the first and last valid timestamp — early/late messages
  // sometimes lack one.
  let first = 0
  let last = 0
  for (const m of messages) {
    if (!m.timestamp) continue
    const t = new Date(m.timestamp).getTime()
    if (!t || Number.isNaN(t)) continue
    if (!first) first = t
    last = t
  }
  if (!first || !last || last <= first) return 0
  return Math.round((last - first) / 60000)
}

// ─── executive summary extraction ───────────────────────────────────────

function extractExecutiveSummary(assistantText) {
  if (!assistantText) return ''
  // Find a heading like ## Executive Summary (any depth, case-insensitive).
  const headingMatch = assistantText.match(/^#{2,}\s*executive summary\s*$/im)
  if (!headingMatch) return ''
  const start = headingMatch.index + headingMatch[0].length
  // Find the next ## heading (two or more hashes at line start).
  const rest = assistantText.slice(start)
  const nextHeading = rest.match(/^#{2,}\s/m)
  const block = nextHeading ? rest.slice(0, nextHeading.index) : rest
  return block.trim()
}

function parseExecBullets(execSummaryText) {
  if (!execSummaryText) return []
  const bullets = []
  for (const raw of execSummaryText.split('\n')) {
    const line = raw.trim()
    if (!/^[-*]/.test(line)) continue
    // Strip the bullet marker and any leading bold label like **Key points:**
    let text = line.replace(/^[-*]\s*/, '').replace(/^\*\*[^*]+\*\*\s*/, '').trim()
    if (!text) continue
    bullets.push(text.slice(0, 200))
    if (bullets.length >= 10) break
  }
  return bullets
}

// ─── memory payload assembly ────────────────────────────────────────────

function buildPayload({ payload, messages, client, repo, branch, remote, commits, filesTouched, signals, duration, projectInfo }) {
  const firstPrompt = extractFirstUserMessage(messages) || '(no user prompt)'
  const lastAssistant = extractLastAssistantText(messages) || ''

  // Subject line — use first ~60 chars of first prompt, single-line.
  const subject = truncate(firstPrompt.replace(/\s+/g, ' '), 60)
  const title = repo ? `${repo}: ${subject}` : subject

  // Body sections
  const sections = []
  sections.push('## Session')
  sections.push(`- Repo: ${repo || '(no git repo)'}`)
  if (branch) sections.push(`- Branch: ${branch}`)
  if (remote) sections.push(`- Remote: ${remote}`)
  sections.push(`- User turns: ${signals.userTurns}`)
  sections.push(`- Tool uses: ${signals.toolUses}`)
  sections.push(`- Files touched: ${filesTouched.length}`)
  if (duration > 0) sections.push(`- Duration: ${duration} min`)
  if (payload.reason) sections.push(`- End reason: ${payload.reason}`)

  sections.push('')
  sections.push('## First user prompt')
  sections.push('')
  sections.push('> ' + truncate(firstPrompt, 1500).replace(/\n/g, '\n> '))

  if (filesTouched.length > 0) {
    sections.push('')
    sections.push('## Files touched')
    sections.push('')
    for (const f of filesTouched.slice(0, 50)) sections.push(`- \`${f}\``)
    if (filesTouched.length > 50) sections.push(`- … and ${filesTouched.length - 50} more`)
  }

  if (commits.length > 0) {
    sections.push('')
    sections.push('## Commits during session')
    sections.push('')
    for (const c of commits) sections.push(`- ${c}`)
  }

  if (lastAssistant) {
    sections.push('')
    sections.push('## Final assistant message (excerpt)')
    sections.push('')
    sections.push(truncate(lastAssistant, 2000))
  }

  const bodyMd = sections.join('\n')

  const execText = extractExecutiveSummary(lastAssistant)
  const summary = execText
    ? truncate(execText.replace(/\s+/g, ' '), 240)
    : truncate(firstPrompt.replace(/\s+/g, ' '), 240)

  const bullets = parseExecBullets(execText)
  const execSummaryField = bullets.length > 0 ? { execSummary: bullets } : {}

  // Deterministic floor for the card headline so nothing lands with a NULL
  // ai_title. enrichWithAiCleanup (if enabled) and the async summariser both
  // override this with better prose.
  const aiTitle = deriveAiTitle(firstPrompt === '(no user prompt)' ? '' : firstPrompt)

  return {
    title: truncate(title, 240),
    bodyMd,
    summary,
    ...(aiTitle ? { aiTitle } : {}),
    ...execSummaryField,
    type: 'session_summary',
    source: client,
    realmId: projectInfo?.realmId ?? DEFAULT_REALM_ID,
    projectId: projectInfo?.id ?? null,
    taskId: null,
    sourceMetadata: {
      // Idempotency key. createMemory dedupes on (source, externalId) against
      // live rows, but nothing ever set it, so every re-capture of one session
      // minted another memory — a SessionEnd and a later backfill of the same
      // session produced two, and the observed Copilot rows show three.
      // Scoped with the client because externalId is only unique per agent.
      ...(payload.session_id ? { externalId: `${client}:${payload.session_id}` } : {}),
      repo: repo || null,
      branch: branch || null,
      remote: remote || null,
      sessionId: payload.session_id || null,
      client,
      cwd: payload.cwd || null,
      hookEvent: payload.hook_event_name || null,
      endReason: payload.reason || null,
      projectName: projectInfo?.name ?? null,
      realmName: projectInfo?.realmName ?? null,
      filesTouched,
      commits,
      stats: {
        userTurns: signals.userTurns,
        toolUses: signals.toolUses,
        durationMin: duration,
        messageCount: messages.length,
      },
    },
    tags: [
      'session',
      client,
      ...(repo ? [repo] : []),
      ...(branch && branch !== 'main' && branch !== 'master' ? [`branch:${branch}`] : []),
    ],
  }
}

// ─── AI cleanup via `claude --print` ────────────────────────────────────
// Opt-in (BRAIN_AI_CLEANUP=1). The server stores whatever we send — there is
// no LLM on the write path. Cleanup happens here, at the call site, by
// invoking the Claude Code CLI in headless mode.
//
// Output contract: a JSON object { aiTitle: string, execSummary: string[] }.
// On any failure (binary missing, timeout, malformed JSON) we silently fall
// back to the un-enriched payload — the hook is never allowed to block.

const CLEANUP_PROMPT = `You are summarising a coding-agent session for a personal memory layer.

Output a JSON object with EXACTLY two keys:
- "aiTitle": a 1-6 word title capturing the main subject (string).
- "execSummary": 5-10 plain-English bullet points describing what happened, what was decided, what is still open. Array of strings, each max 120 characters.

Reply with ONLY the raw JSON object — no markdown fences, no commentary.

---SESSION BODY---
`

function extractJson(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try { return JSON.parse(trimmed) } catch { /* try fallbacks */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) } catch { /* try next */ }
  }
  const obj = trimmed.match(/\{[\s\S]*\}/)
  if (obj) {
    try { return JSON.parse(obj[0]) } catch { /* give up */ }
  }
  return null
}

function enrichWithAiCleanup(payload) {
  if (!AI_CLEANUP) return payload
  const body = payload.bodyMd || ''
  if (!body) return payload

  // Cap the body we ship to the model so the prompt stays in budget. The
  // raw body can be 4–8k chars after files/commits/transcript snippets —
  // truncating to 6k is plenty for a faithful summary.
  const capped = body.length > 6000 ? body.slice(0, 6000) + '\n…(truncated)…' : body
  const prompt = CLEANUP_PROMPT + capped + '\n---END SESSION---'

  let raw
  try {
    raw = execFileSync(AI_CLEANUP_BIN, ['--print'], {
      input: prompt,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: AI_CLEANUP_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, AEON_HOOK_CHILD: '1' },
    })
  } catch (err) {
    warn(`ai-cleanup: ${AI_CLEANUP_BIN} --print failed (${err.code ?? err.message}). Posting un-enriched payload.`)
    return payload
  }

  const parsed = extractJson(raw)
  if (!parsed || typeof parsed.aiTitle !== 'string' || !Array.isArray(parsed.execSummary)) {
    warn('ai-cleanup: response did not match { aiTitle, execSummary } — posting un-enriched payload.')
    log('ai-cleanup raw output:', String(raw).slice(0, 400))
    return payload
  }

  const aiTitle = parsed.aiTitle.trim().slice(0, 120)
  const execSummary = parsed.execSummary
    .filter((b) => typeof b === 'string')
    .map((b) => b.trim().slice(0, 500))
    .filter((b) => b.length > 0)
    .slice(0, 15)

  if (!aiTitle || execSummary.length === 0) return payload

  log(`ai-cleanup: title="${aiTitle}", bullets=${execSummary.length}`)
  return { ...payload, aiTitle, execSummary }
}

// ─── HTTP POST ──────────────────────────────────────────────────────────

// Returns { id, status }: id is the created/upserted memory id (or null on
// skip/fail); status is the HTTP status (0 on network error/timeout, null when
// not attempted). The backfill loop reads status to pace itself and back off
// when the server is under pressure instead of barrelling through the batch.
async function postMemory(payload) {
  const url = `${BASE_URL}/api/v1/memories`
  let requestPayload = payload
  let fallbackUsed = false
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })
      const text = await res.text()
      lastStatus = res.status
      if (!res.ok && res.status === 400 && !fallbackUsed && (payload.source === 'codex' || payload.source === 'copilot')) {
        fallbackUsed = true
        requestPayload = {
          ...payload,
          source: 'hook',
          sourceMetadata: { ...payload.sourceMetadata, originalSource: payload.source },
        }
        log(`source=${payload.source} unsupported by server; retrying as source=hook`)
        attempt--
        continue
      }
      if (res.ok) {
        try {
          const parsed = JSON.parse(text)
          return { id: parsed?.data?.id ?? null, status: res.status }
        } catch {
          return { id: null, status: res.status }
        }
      }
      const transient = res.status === 429 || res.status >= 500
      if (!transient || attempt === 3) {
        warn(`POST failed ${res.status}: ${text.slice(0, 500)}`)
        return { id: null, status: res.status }
      }
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt)
    } catch (err) {
      if (attempt === 3) {
        warn(`POST error: ${err.message}`)
        return { id: null, status: 0 }
      }
      await sleep(500 * 2 ** attempt)
    } finally {
      clearTimeout(timeout)
    }
  }
  return { id: null, status: lastStatus }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── shared session processor ───────────────────────────────────────────

// Process a single session transcript end-to-end: parse, quality-gate,
// build payload, post. Returns memory id on success, null on skip/fail.
async function processSession({ transcriptPath, transcriptRecords, sessionId, cwd, hookEvent, reason, retryOnEmpty = false }) {
  const sessionLabel = transcriptPath ? basename(transcriptPath) : `${sessionId || 'unknown'} (Copilot)`
  const records = transcriptRecords || parseTranscript(transcriptPath)
  if (!records || records.length === 0) {
    log(`skip ${sessionLabel}: no transcript or empty`)
    return { id: null, status: null, retry: retryOnEmpty }
  }
  const { client, messages } = normalizeTranscript(records)

  // Drop sessions our own hooks spawned (summariser / AI-cleanup children) so
  // the brain never fills with "memories about summarising memories".
  if (isAutomatedSession(messages)) {
    log(`skip ${sessionLabel}: automated hook-child session`)
    return { id: null, status: null }
  }

  const signals = countSignals(messages)
  const filesTouched = extractFilesTouched(messages)
  const hasExecSummary = !!extractExecutiveSummary(extractLastAssistantText(messages) || '')

  // Substance gate. Keep anything with real output (files / tool work / a proper
  // Executive Summary) AND genuine multi-turn conversations (design & planning
  // sessions touch no files but are worth remembering). Drop empty stubs and
  // one-line throwaways — the "half of it is dirty" complaint.
  const substantive =
    hasExecSummary ||
    filesTouched.length > 0 ||
    signals.toolUses >= MIN_TOOL_USES ||
    (signals.userTurns >= MIN_USER_TURNS && signals.userTextChars >= 240)
  if (!substantive) {
    log(`skip ${sessionLabel}: below substance gate (turns=${signals.userTurns}, tools=${signals.toolUses}, files=${filesTouched.length}, chars=${signals.userTextChars})`)
    return { id: null, status: null }
  }

  // Resolve cwd from the transcript itself if not provided (backfill path).
  // Most Claude Code messages carry a `cwd` field — use the earliest one.
  const resolvedCwd =
    cwd ||
    messages.find((m) => typeof m.cwd === 'string' && m.cwd.length > 0)?.cwd ||
    process.cwd()

  const branch = gitCmd(resolvedCwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const remote = gitCmd(resolvedCwd, ['remote', 'get-url', 'origin'])
  // Repo slug strategy: prefer the dev_26 folder name (stable across forks /
  // remotes), fall back to git-remote basename, then cwd basename.
  const repoSlug =
    repoSlugFromCwd(resolvedCwd) ||
    (remote ? basename(remote).replace(/\.git$/, '') : null) ||
    (branch ? basename(resolvedCwd) : null)
  const repo = repoSlug

  // Resolve the matching Aeon project (and its realm) for this repo.
  const projectName = repoToProjectName(repoSlug)
  const projectInfo = projectName ? await resolveProject(projectName) : null

  const since = (() => {
    const first = messages[0]?.timestamp
    return first ? `--since=${first}` : '--since=24.hours.ago'
  })()
  const commitsRaw = gitCmd(resolvedCwd, ['log', '--pretty=%h %s', since, '-n', '20'])
  const commits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : []

  const duration = sessionDurationMin(messages)

  const rawPayload = buildPayload({
    payload: {
      session_id: sessionId,
      cwd: resolvedCwd,
      hook_event_name: hookEvent,
      reason,
    },
    messages,
    client,
    repo,
    branch,
    remote,
    commits,
    filesTouched,
    signals,
    duration,
    projectInfo,
  })

  // Optional AI cleanup pass — adds aiTitle + execSummary when BRAIN_AI_CLEANUP=1.
  const memoryPayload = enrichWithAiCleanup(rawPayload)

  if (DRY_RUN) {
    console.error(`[brain-capture] DRY RUN ${sessionLabel} — payload follows:`)
    console.error(JSON.stringify(memoryPayload, null, 2))
    return { id: null, status: null }
  }

  const result = await postMemory(memoryPayload)
  if (result.id) {
    const { recordCaptureReceipt } = await import('./session-capture-queue.mjs')
    recordCaptureReceipt(client, sessionId, result.id)
  }
  return result
}

// ─── backfill mode ──────────────────────────────────────────────────────

const BACKFILL_LOCK = join(tmpdir(), 'aeon-brain-backfill.lock')
const BACKFILL_LOCK_TTL_MS = 60_000
const BACKFILL_MIN_IDLE_MS = 5 * 60_000  // skip transcripts mtime within last 5 min (likely still active)

function acquireBackfillLock() {
  try {
    if (existsSync(BACKFILL_LOCK)) {
      const lockAge = Date.now() - statSync(BACKFILL_LOCK).mtimeMs
      if (lockAge < BACKFILL_LOCK_TTL_MS) return false
      // Stale lock — overwrite below.
    }
    writeFileSync(BACKFILL_LOCK, String(process.pid))
    return true
  } catch {
    return false
  }
}

function releaseBackfillLock() {
  try { unlinkSync(BACKFILL_LOCK) } catch { /* ignore */ }
}

// Find every *.jsonl under ~/.claude/projects/<projectDir>/ whose mtime
// falls inside [now - hoursWindow, now - 5min]. Claude Code stores each
// transcript as <sessionId>.jsonl directly under the project directory
// (the uuid-named subdirs hold subagent state, not main transcripts).
function findCandidateTranscripts(hoursWindow) {
  const projectsRoot = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsRoot)) return []
  const now = Date.now()
  const minMtime = now - hoursWindow * 3600 * 1000
  const maxMtime = now - BACKFILL_MIN_IDLE_MS
  const out = []
  for (const projectDir of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, projectDir)
    let entries
    try { entries = readdirSync(dir) } catch { continue }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue
      const fullPath = join(dir, file)
      let st
      try { st = statSync(fullPath) } catch { continue }
      if (!st.isFile()) continue
      if (st.mtimeMs < minMtime || st.mtimeMs > maxMtime) continue
      out.push({
        path: fullPath,
        sessionId: file.replace(/\.jsonl$/, ''),
        mtime: st.mtimeMs,
      })
    }
  }
  // Process newest-first so a hard-cap stops after the most recent work.
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function runBackfill(hoursWindow) {
  if (!API_KEY) bail('AEON_API_KEY not set')

  if (!acquireBackfillLock()) {
    log('backfill: another run holds the lock — skipping')
    return
  }

  try {
    const candidates = findCandidateTranscripts(hoursWindow)
    log(`backfill: ${candidates.length} candidate transcript(s) in last ${hoursWindow}h`)

    let queued = 0
    const MAX = parseInt(process.env.BRAIN_BACKFILL_MAX ?? '50', 10)

    for (const c of candidates.slice(0, MAX)) {
      if (enqueueCapture({
        client: 'claude',
        transcript_path: c.path,
        session_id: c.sessionId,
        cwd: null,
        hook_event_name: 'SessionEndBackfill',
        reason: 'backfill',
      })) queued++
    }
    if (queued > 0) startCaptureDrain()
    log(`backfill: queued=${queued}`)
  } finally {
    releaseBackfillLock()
  }
}

// ─── main ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { backfill: false, queueWorker: false, hours: parseInt(process.env.BRAIN_BACKFILL_HOURS ?? '48', 10) }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backfill') out.backfill = true
    else if (args[i] === '--queue-worker') out.queueWorker = true
    else if (args[i] === '--hours' && args[i + 1]) { out.hours = parseInt(args[++i], 10) || out.hours }
  }
  return out
}

async function runFromHook() {
  if (!API_KEY) bail('AEON_API_KEY not set')
  // Hooks tag the Claude processes they spawn (summariser, AI cleanup) with
  // this env var. Such children must never capture themselves as a memory.
  if (process.env.AEON_HOOK_CHILD === '1') bail('hook-child session — skip capture')
  const payload = readStdin()
  let transcriptRecords = null
  if (payload.client === 'copilot') {
    const { loadCopilotTranscriptWhenReady } = await import('./copilot-session-transcript.mjs')
    // Copilot emits SessionEnd before its final SQLite turn is durable. Re-read
    // for at most two seconds and proceed as soon as both sides of the final
    // conversation exist, before the shared substance gate sees the transcript.
    transcriptRecords = await loadCopilotTranscriptWhenReady(payload.session_id)
  }
  log('payload event:', payload.hook_event_name, 'reason:', payload.reason)
  const result = await processSession({
    transcriptPath: payload.transcript_path,
    transcriptRecords,
    sessionId: payload.session_id,
    cwd: payload.cwd,
    hookEvent: payload.hook_event_name,
    reason: payload.reason,
    retryOnEmpty: payload.client === 'copilot',
  })
  if (result.id) log(`memory created/upserted: ${result.id}`)
  return result
}

async function main() {
  const args = parseArgs()
  if (args.backfill) {
    await runBackfill(args.hours)
  } else {
    const result = await runFromHook()
    if (args.queueWorker && !result?.id) process.exitCode = result?.retry || result?.status !== null ? 2 : 3
  }
}

main().catch((err) => {
  warn(`unhandled: ${err.message}`)
  process.exitCode = process.argv.includes('--queue-worker') ? 2 : 0
})
