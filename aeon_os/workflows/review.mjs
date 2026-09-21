#!/usr/bin/env node

// Independent review gate for the Aeon OS production workflow proof.
//
// Why this module exists: the mechanical validator in run.mjs measures
// plumbing (terminal status, exit code, one report-only commit, citation path
// exists and line is in range). On 2026-09-11 it recorded a batch 10/10
// `passed` while three independent reviewers, reading the cited lines at the
// pinned revision, returned 0 clean passes and 4 outright failures. Mechanical
// PASS therefore does not imply the delivered research is trustworthy, and a
// gate that stops at plumbing overstates readiness.
//
// This module owns the second half of the gate: build the reviewer package,
// dispatch a reviewer that is NOT the mission model, parse a strict JSON
// verdict, store it durably, and decide the run's terminal state from the
// verdicts alone. Anything it cannot parse counts as NOT reviewed — never as a
// pass.

import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildRunBundle, markdown } from './review-bundle.mjs'
import { copilotExecutable, listCopilotModels } from './probe-copilot-models.mjs'

export const VERDICTS = ['PASS', 'PASS_WITH_CORRECTIONS', 'FAIL']
// An allowlist, deliberately. A blocklist of severity words is unenforceable:
// a reviewer that says "blocker", "high", "severe", "fatal" or "showstopper"
// alongside a PASS would slip through one, and the whole point of the gate is
// that a self-contradictory PASS must never count. Anything not recognised as
// cosmetic therefore contradicts a PASS.
export const PASS_COMPATIBLE_SEVERITIES = new Set(['minor', 'info', 'informational', 'nit', 'none', 'n/a', 'na'])
// The WHOLE prompt (instruction + bundle) is piped to the reviewer's stdin and
// -p is never passed: the Copilot CLI docs state that piped input is ignored
// when -p/--prompt is also given, and the first live gate run (2026-09-16)
// proved it — the reviewer returned a FAIL saying no bundle was present.
// stdin-only delivery was then verified on CLI 1.0.85: a 37k-character prompt
// piped with no -p was fully inlined (input tokens rose by ~8k) and answered
// correctly. Piping sidesteps the 32767-character Windows command-line cap
// without granting a file-reading tool. The ceiling is the largest delivery
// actually measured, not a guess at the model's context: a 118,754-character
// prompt piped the same day was fully inlined (lastCallInputTokens 38,159)
// and the token near its end was answered. Raise it only after a bigger prompt
// has been proven the same way. Above it the run stays unreviewed and goes to
// a human or another agent via --import.
export const MAX_PROMPT_CHARS = 110_000
// Statuses a run may be archived from by `prepare --new`. review_pending and
// partial_pass are normal end states of the gate, so leaving them out would
// force a hand-edited state.json to abandon a run.
export const ARCHIVABLE_STATUSES = ['failed', 'passed', 'partial_pass', 'review_pending']
// Owner directive 1709: the reviewer runs GPT-5.6 Sol at high effort on the
// 1M-context tier. Both are passed on argv because the CLI does not restore
// contextTier from settings.json at startup (github/copilot-cli#3557).
const DEFAULT_REVIEW = { engine: 'copilot', model: 'gpt-5.6-sol', effort: 'high', context: 'long_context', maxAiCredits: 30, timeoutMs: 900_000 }
const REVIEW_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const REVIEW_CONTEXTS = new Set(['default', 'long_context'])

/** `prepare --new` policy: may this run be archived, and was its review left unfinished? */
export function archiveDecision(status) {
  return { allowed: ARCHIVABLE_STATUSES.includes(status), abandoned: status === 'review_pending' }
}

/** Whether the whole reviewer prompt (instruction + bundle) can be piped to stdin. */
export function promptFits(promptText) {
  return typeof promptText === 'string' && promptText.length <= MAX_PROMPT_CHARS
}

/**
 * Independence is only real if the model that answered is the model we asked
 * for. Provider-side substitution or a silent fallback would otherwise let the
 * mission model grade its own report while the record claims otherwise.
 * Returns a reason to reject the verdict, or null when provenance is sound.
 */
export function modelProvenanceError({ observedModel, configuredModel, missionModel, allowSameModel = false }) {
  if (!observedModel) return null
  if (observedModel !== configuredModel) {
    return `reviewer reported model ${observedModel} but ${configuredModel} was requested; the verdict is not attributable to the configured reviewer`
  }
  if (observedModel === missionModel && !allowSameModel) {
    return `reviewer reported model ${observedModel}, the same model that wrote the report; an independent review needs a different model`
  }
  return null
}

function errorMessage(err) { return err instanceof Error ? err.message : String(err) }
function pad(index) { return String(index).padStart(2, '0') }
function now() { return new Date().toISOString() }

export function reviewsDir(runDir) { return join(runDir, 'reviews') }

export function reviewConfig(bootstrap) {
  const block = bootstrap && typeof bootstrap === 'object' && bootstrap.review && typeof bootstrap.review === 'object' ? bootstrap.review : {}
  const cfg = { ...DEFAULT_REVIEW, ...block }
  if (cfg.engine !== 'copilot') throw new Error(`review.engine ${JSON.stringify(cfg.engine)} is not supported; only 'copilot' is implemented`)
  if (typeof cfg.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cfg.model)) throw new Error('review.model in bootstrap.json is missing or unsafe')
  if (!REVIEW_EFFORTS.has(cfg.effort)) throw new Error(`review.effort must be one of ${[...REVIEW_EFFORTS].join(', ')}`)
  if (!REVIEW_CONTEXTS.has(cfg.context)) throw new Error(`review.context must be one of ${[...REVIEW_CONTEXTS].join(', ')}`)
  if (!Number.isInteger(cfg.maxAiCredits) || cfg.maxAiCredits < 1 || cfg.maxAiCredits > 200) throw new Error('review.maxAiCredits must be an integer from 1 to 200')
  if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 60_000 || cfg.timeoutMs > 3_600_000) throw new Error('review.timeoutMs must be an integer between 60000 and 3600000')
  return cfg
}

// ---------------------------------------------------------------- schema ---

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!allowEmpty && !value.trim()) throw new Error(`${label} must not be empty`)
  return value
}

const PAYLOAD_KEYS = new Set(['verdict', 'findings', 'summary', 'receipt', 'marker'])
const FINDING_KEYS = new Set(['claim', 'cited', 'actual', 'severity'])

// Strict about meaning, tolerant of noise: unknown keys are kept and reported
// as schema notes rather than rejected, because an extra field can never turn
// a FAIL into a PASS but a rejection costs a paid re-run.
export function validateVerdictPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('verdict must be a JSON object')
  const notes = []
  const verdict = value.verdict
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict)) {
    throw new Error(`verdict must be exactly one of ${VERDICTS.join(', ')}; received ${JSON.stringify(verdict)}`)
  }
  if (!Array.isArray(value.findings)) throw new Error('findings must be an array')
  const findings = value.findings.map((finding, index) => {
    const label = `findings[${index}]`
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) throw new Error(`${label} must be an object`)
    const extra = Object.keys(finding).filter(key => !FINDING_KEYS.has(key))
    if (extra.length) notes.push(`${label} carried unrecognised keys: ${extra.join(', ')}`)
    return {
      ...finding,
      claim: requireString(finding.claim, `${label}.claim`),
      cited: requireString(finding.cited, `${label}.cited`, { allowEmpty: true }),
      actual: requireString(finding.actual, `${label}.actual`),
      severity: requireString(finding.severity, `${label}.severity`),
    }
  })
  const summary = requireString(value.summary, 'summary')
  if (verdict !== 'PASS' && findings.length === 0) throw new Error(`verdict ${verdict} must list at least one finding`)
  if (verdict === 'PASS') {
    const contradiction = findings.find(finding => !PASS_COMPATIBLE_SEVERITIES.has(finding.severity.trim().toLowerCase()))
    if (contradiction) throw new Error(`verdict PASS contradicts a ${contradiction.severity} finding: ${contradiction.claim}`)
  }
  const extra = Object.keys(value).filter(key => !PAYLOAD_KEYS.has(key))
  if (extra.length) notes.push(`verdict carried unrecognised top-level keys: ${extra.join(', ')}`)
  return { verdict, findings, summary, schemaNotes: notes }
}

export function validateReviewer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('reviewer must be a JSON object')
  return {
    ...value,
    engine: requireString(value.engine, 'reviewer.engine'),
    model: requireString(value.model, 'reviewer.model'),
    startedAt: requireString(value.startedAt, 'reviewer.startedAt'),
    finishedAt: requireString(value.finishedAt, 'reviewer.finishedAt'),
  }
}

export function validateVerdictRecord(value) {
  const payload = validateVerdictPayload(value)
  const reviewer = validateReviewer(value?.reviewer)
  return { ...value, ...payload, reviewer }
}

// Direct parse first. A single fenced ```json block is the one concession to
// models that cannot resist formatting; anything looser is refused so that
// prose containing the word PASS can never be read as a verdict.
export function parseVerdictText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'reviewer produced no output' }
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'reviewer produced empty output' }
  try { return { ok: true, value: JSON.parse(trimmed) } } catch { /* try a fence */ }
  const fences = [...trimmed.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)```/g)].map(match => match[1])
  if (fences.length !== 1) {
    return { ok: false, error: `reviewer output is not a single JSON object (found ${fences.length} fenced block(s))` }
  }
  try { return { ok: true, value: JSON.parse(fences[0].trim()) } } catch (err) {
    return { ok: false, error: `reviewer output fence is not valid JSON: ${errorMessage(err)}` }
  }
}

// ------------------------------------------------------------------ gate ---

export function loadVerdicts(runDir) {
  const dir = reviewsDir(runDir)
  const verdicts = new Map()
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return verdicts
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = /^(\d{2})\.json$/.exec(entry.name)
    if (!match) continue
    const index = Number(match[1])
    let parsed
    try { parsed = JSON.parse(readFileSync(join(dir, entry.name), 'utf8')) } catch (err) {
      verdicts.set(index, { attempt: index, ok: false, error: `stored verdict is not valid JSON: ${errorMessage(err)}`, file: entry.name })
      continue
    }
    try {
      // The filename alone must never establish which attempt a verdict is
      // about. Without this, one clean PASS copied to 01.json … 10.json passes
      // the whole batch.
      if (!Number.isInteger(parsed?.attempt)) throw new Error('stored verdict has no integer "attempt" field, so it cannot be tied to an attempt')
      if (parsed.attempt !== index) throw new Error(`stored verdict names attempt ${parsed.attempt} but its filename names ${index}`)
      verdicts.set(index, { attempt: index, ok: true, record: validateVerdictRecord(parsed), file: entry.name })
    } catch (err) {
      verdicts.set(index, { attempt: index, ok: false, error: errorMessage(err), file: entry.name })
    }
  }
  // A dispatch whose output failed to parse leaves an error sidecar and no
  // verdict file. Surface its reason instead of a bare "not reviewed".
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const match = /^(\d{2})\.error\.json$/.exec(entry.name)
    if (!match) continue
    const index = Number(match[1])
    if (verdicts.has(index)) continue
    let reason = 'reviewer output could not be parsed'
    try { reason = JSON.parse(readFileSync(join(dir, entry.name), 'utf8'))?.error ?? reason } catch { /* keep the default */ }
    verdicts.set(index, { attempt: index, ok: false, error: reason, file: entry.name })
  }
  return verdicts
}

// Pure decision function — the whole point of the gate, kept free of I/O so it
// can be exercised with synthetic verdicts.
//
//   any attempt not mechanically PASS      -> failed
//   any attempt without a valid verdict    -> review_pending
//   every verdict exactly PASS             -> passed (partial_pass under 10)
//   otherwise                              -> failed, outcome review_failed
export function evaluateReviewGate({ attempts, verdicts, fullBatch = 10 }) {
  const list = Array.isArray(attempts) ? attempts : []
  const map = verdicts instanceof Map ? verdicts : new Map(Object.entries(verdicts ?? {}).map(([key, value]) => [Number(key), value]))
  const counts = { PASS: 0, PASS_WITH_CORRECTIONS: 0, FAIL: 0 }
  const unreviewed = []
  const perAttempt = []
  for (const attempt of list) {
    let entry = map.get(attempt.index)
    // A stored record that names a different report marker than the attempt
    // it is filed under was written for something else; it reviews nothing here.
    if (entry?.ok && typeof entry.record.marker === 'string' && typeof attempt.marker === 'string' && entry.record.marker !== attempt.marker) {
      entry = { ...entry, ok: false, error: `stored verdict names marker ${entry.record.marker} but attempt ${attempt.index} carries ${attempt.marker}` }
    }
    const verdict = entry?.ok ? entry.record.verdict : null
    if (verdict) counts[verdict] += 1
    else unreviewed.push({ attempt: attempt.index, reason: entry ? entry.error : 'no stored review verdict' })
    perAttempt.push({
      attempt: attempt.index,
      mechanical: attempt.result ?? null,
      verdict,
      reviewer: entry?.ok ? entry.record.reviewer.engine : null,
      reviewerModel: entry?.ok ? entry.record.reviewer.model : null,
      error: entry?.ok ? null : entry?.error ?? null,
    })
  }
  const mechanicalFailure = list.find(attempt => attempt.result && attempt.result !== 'PASS')
  const summary = {
    total: list.length,
    reviewed: list.length - unreviewed.length,
    counts,
    unreviewed,
    attempts: perAttempt,
    updatedAt: now(),
  }
  if (!list.length) return { ...summary, outcome: 'review_pending', status: 'review_pending' }
  if (mechanicalFailure) {
    return { ...summary, outcome: 'mechanical_failed', status: 'failed', blockedBy: `attempt ${mechanicalFailure.index} is ${mechanicalFailure.result}` }
  }
  if (unreviewed.length) return { ...summary, outcome: 'review_pending', status: 'review_pending' }
  if (counts.PASS === list.length) {
    return { ...summary, outcome: 'review_passed', status: list.length >= fullBatch ? 'passed' : 'partial_pass' }
  }
  return { ...summary, outcome: 'review_failed', status: 'failed' }
}

// --------------------------------------------------------------- prompts ---

const RULES = [
  'The bundle below contains the full report and, for every citation it makes, the ACTUAL source lines read from the exact pinned git revision. The cited line is marked with ">". Those resolved lines are your only ground truth.',
  'Verify EVERY numbered claim and finding in the report against those resolved lines. Never accept a claim because it sounds plausible, because the file name matches, or because the report sounds confident.',
  'A claim that the cited code contradicts is a FAIL. A claim whose citation does not resolve, or which cites nothing at all, is a FAIL.',
  'Citation drift is at least PASS_WITH_CORRECTIONS: the cited line is off by a few lines, or it points at a function declaration, an import, a comment or a test title instead of the code that evidences the claim.',
  'Inference presented as observation, and findings that are vague, obvious or not independently useful, are at least PASS_WITH_CORRECTIONS.',
  'A statement the report itself labels as Inference, or places under a heading "Unverified observations", is not presented as observation: judge it only for honest labelling and for contradiction with the resolved lines, and do not fail the report for the absence of a citation there. Everything the report presents as observed or as a numbered finding is held to the full standard.',
  'PASS means every claim is accurate AND every citation points at the evidence for it. If you are not certain, do not award PASS.',
  'Judge only what is in this message. Do not modify anything, and do not go looking for other files.',
]

const OUTPUT_CONTRACT = `Output a SINGLE JSON object and nothing else. No prose before or after it, no markdown, no code fence.

{"receipt":"the token on the line beginning 'Receipt:' at the end of the bundle, copied verbatim","verdict":"PASS"|"PASS_WITH_CORRECTIONS"|"FAIL","findings":[{"claim":"the report's claim, quoted or closely paraphrased","cited":"the citation exactly as the report wrote it","actual":"what the resolved source lines actually show","severity":"blocking"|"major"|"minor"|"info"}],"summary":"one paragraph: would a paying user be able to trust this report?"}

"receipt" proves you received the whole bundle: copy the token exactly as it appears there. "findings" must contain at least one entry whenever the verdict is not PASS, and must list every problem you found rather than only the first. A PASS may not carry a blocking or major finding.`

// Proof of receipt. A fresh random token is generated per dispatch and placed
// ONLY at the tail of the piped bundle, never in the instruction, so a reviewer
// can only echo it by having read the bundle to its end. 1609: the first live
// reviewer judged an empty message (Copilot drops piped input when -p is
// present) and its schema-valid FAIL was stored as a real verdict. The report
// marker was tried first and rejected by review: it is AEON_OS_E2E_<runId>_NN
// and the run id sat in the instruction header, so it could be reconstructed.
export function receiptEchoError(payload, expectedReceipt) {
  // Fail closed: a dispatch without a receipt to check is a harness bug, not a pass.
  if (typeof expectedReceipt !== 'string' || !expectedReceipt) return 'no receipt token was issued for this dispatch; the verdict cannot be tied to the bundle'
  const echoed = payload?.receipt
  if (typeof echoed !== 'string' || echoed.trim() === '') return 'reviewer did not echo the receipt token; it cannot be shown to have received the bundle'
  if (echoed.trim() !== expectedReceipt) return `reviewer echoed receipt ${JSON.stringify(echoed.trim())} but the bundle carried a different token; the verdict is not attributable to this bundle`
  return null
}

// One text, piped whole to the reviewer's stdin (never -p, see MAX_PROMPT_CHARS).
// The header names the attempt but not the run id: nothing in the instruction
// may let a reviewer reconstruct what only the bundle carries.
export function buildReviewPrompt({ runId, attempt, bundleText, revision = null, receipt = randomUUID() }) {
  const header = [
    'You are an INDEPENDENT reviewer. A different AI model wrote the research report you are about to judge, and your job is to decide whether a paying user could trust it.',
    revision ? `Pinned revision under review: ${revision}` : null,
    `Attempt ${pad(attempt)}.`,
    '',
    'Rules of evidence:',
    ...RULES.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    OUTPUT_CONTRACT,
    '',
  ].filter(line => line !== null).join('\n')
  const text = `${header}===== REVIEW BUNDLE — attempt ${pad(attempt)} =====\n${bundleText}\nReceipt: ${receipt}\n===== END OF REVIEW BUNDLE =====\n\nRespond with the JSON object only.\n`
  return { text, receipt, runId }
}

// -------------------------------------------------------------- dispatch ---

const SECRET_ENV_VARS = [
  'KAIROS_AEON_API_KEY', 'AEON_API_KEY', 'KAIROS_CALLBACK_TOKEN', 'KAIROS_WORKER_SECRET', 'AEON_MCP_TOKEN',
  'DATABASE_URL', 'POSTGRES_URL', 'GITHUB_TOKEN', 'GH_TOKEN', 'RESEND_API_KEY', 'PUSHER_SECRET', 'NEXTAUTH_SECRET',
]

function reviewerEnv() {
  const env = { ...process.env, NODE_USE_SYSTEM_CA: '1', NODE_TLS_REJECT_UNAUTHORIZED: '1' }
  // Same containment the mission wrapper applies: the reviewer never needs an
  // Aeon credential and must not be able to touch the board.
  for (const name of ['KAIROS_AEON_API_KEY', 'AEON_API_KEY', 'KAIROS_CALLBACK_TOKEN', 'KAIROS_WORKER_SECRET', 'AEON_MCP_TOKEN']) delete env[name]
  return env
}

// Flags verified against the installed Copilot CLI 1.0.83 (`copilot --help`
// and `copilot help permissions`, probed 2026-09-12).
//
// Containment rests on three independent legs, because no single one is
// sufficient:
//   1. cwd is a throwaway directory under the OS temp root, OUTSIDE the git
//      working tree. Copilot restricts file access to the cwd subtree by
//      default and --allow-all-paths is never passed, so runner.env.bat,
//      apps/web/.env.local and the repository itself are simply unreachable.
//   2. --disallow-temp-dir removes the implicit grant over the rest of the
//      temp root, leaving only the per-attempt scratch.
//   3. Path verification does not constrain the shell tool, so shell is denied
//      outright. Denial beats --allow-all-tools by documented precedence.
//
// The deny list is ordered url, write, shell on purpose. If this build appends
// repeated --deny-tool values, all three are denied; if it replaces them, the
// last one wins and that must be the dangerous one.
// No -p: the prompt arrives on stdin, and Copilot ignores piped input whenever
// -p is present. Passing both would silently review nothing.
export function reviewerArgs({ model, effort, context, maxAiCredits, usageFile }) {
  return [
    '--model', model,
    ...(effort ? ['--reasoning-effort', effort] : []),
    ...(context ? ['--context', context] : []),
    '--allow-all-tools',
    '--deny-tool=url',
    '--deny-tool=write',
    '--deny-tool=shell',
    `--secret-env-vars=${SECRET_ENV_VARS.join(',')}`,
    '--no-ask-user',
    '--no-custom-instructions',
    '--no-auto-update',
    '--no-remote',
    '--no-remote-export',
    '--no-color',
    '--silent',
    '--log-level', 'none',
    '--disallow-temp-dir',
    '--disable-mcp-server', 'aeon',
    '--disable-mcp-server', 'playwright',
    '--disable-builtin-mcps',
    '--max-ai-credits', String(maxAiCredits),
    '--usage-output-file', usageFile,
  ]
}

// Kill the whole process tree, not just the CLI. A bare kill reaps copilot.exe
// and leaves its tool subprocesses running; a survivor whose current directory
// sits inside the scratch we are about to delete pins that directory on Windows
// (EPERM on rmSync, EBUSY on renameSync) — the exact locker class the
// 11 September worktree investigation measured.
export function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    return
  }
  try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
}

// Shape verified against a real --usage-output-file from Copilot CLI 1.0.85
// (probed 2026-09-16): the answering model is `currentModel`, and every model
// that served a request in the session is a key of `modelMetrics`. If more than
// one model served the session, the verdict cannot be attributed to a single
// model and the joined list will fail the provenance check by design.
export function observedModelFromUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const served = usage.modelMetrics && typeof usage.modelMetrics === 'object' ? Object.keys(usage.modelMetrics) : []
  if (served.length > 1) return served.sort().join('+')
  if (typeof usage.currentModel === 'string' && usage.currentModel) return usage.currentModel
  return served[0] ?? null
}

// `buildArgs` is a seam for the stdin-delivery test only; production always
// passes the default.
export function dispatchCopilotReview({ binary, model, effort, context, stdinText, cwd, maxAiCredits, timeoutMs, usageFile, buildArgs = reviewerArgs }) {
  return new Promise((done) => {
    const startedAt = now()
    // An empty prompt would dispatch a reviewer that judges nothing and still
    // exits 0 with schema-valid JSON. Refuse before spawning.
    // argv is computed first and returned on every path so a test can lock the
    // PRODUCTION argument builder (no -p) without spawning the real CLI.
    const argv = buildArgs({ model, effort, context, maxAiCredits, usageFile })
    if (typeof stdinText !== 'string' || stdinText.trim() === '') {
      done({ startedAt, finishedAt: now(), stdout: '', stderr: '', status: null, signal: null, spawnError: 'reviewer prompt is empty; nothing was dispatched', timedOut: false, usage: null, observedModel: null, argv })
      return
    }
    const limit = 64 * 1024 * 1024
    let stdout = ''
    let stderr = ''
    let spawnError = null
    let timedOut = false
    let settled = false
    const child = spawn(binary, argv, {
      cwd,
      env: reviewerEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // A process group elsewhere lets process.kill(-pid) reach the children;
      // on Windows taskkill /T does that job and detaching only hides the shim.
      detached: process.platform !== 'win32',
    })
    // The whole prompt goes down stdin and the pipe is closed so the CLI knows
    // the input is complete. A reviewer that exits early (bad flag, auth
    // failure) closes its end first; that EPIPE is telemetry, not a crash.
    child.stdin?.on('error', () => { /* child closed the pipe early; the exit code tells the story */ })
    child.stdin?.end(stdinText)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { if (stdout.length < limit) stdout += chunk })
    child.stderr?.on('data', (chunk) => { if (stderr.length < limit) stderr += chunk })
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid) }, timeoutMs)
    const finish = (status, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let usage = null
      try { if (existsSync(usageFile)) usage = JSON.parse(readFileSync(usageFile, 'utf8')) } catch { /* telemetry only */ }
      done({
        startedAt,
        finishedAt: now(),
        stdout,
        stderr,
        status: status ?? null,
        signal: signal ?? null,
        spawnError,
        timedOut,
        usage,
        observedModel: observedModelFromUsage(usage),
        argv,
      })
    }
    child.once('error', (err) => { spawnError = errorMessage(err); finish(null, null) })
    child.once('close', (status, signal) => finish(status, signal))
    // 'close' waits for every stdio pipe to reach EOF. A grandchild that
    // inherited stdout and outlived the CLI would hold it open forever, so the
    // exit itself settles the dispatch after a short drain grace.
    child.once('exit', (status, signal) => { setTimeout(() => finish(status, signal), 10_000).unref() })
  })
}

// ----------------------------------------------------------- persistence ---

function assertNoSecret(secrets, label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of secrets ?? []) {
    if (secret && text.includes(secret)) throw new Error(`${label} contained a credential; it was not persisted`)
  }
}

function writeRecord(runDir, index, record) {
  const dir = reviewsDir(runDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${pad(index)}.json`), `${JSON.stringify(record, null, 2)}\n`)
}

// Dispatched output and imported verdicts get separate raw files so an import
// can never erase the evidence a real reviewer produced.
function writeRaw(runDir, index, text, kind = 'raw') {
  const dir = reviewsDir(runDir)
  mkdirSync(dir, { recursive: true })
  const name = kind === 'import' ? `${pad(index)}.import.raw.txt` : `${pad(index)}.raw.txt`
  writeFileSync(join(dir, name), text)
  return `reviews/${name}`
}

function writeError(runDir, index, payload) {
  const dir = reviewsDir(runDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${pad(index)}.error.json`), `${JSON.stringify(payload, null, 2)}\n`)
}

function clearError(runDir, index) {
  const file = join(reviewsDir(runDir), `${pad(index)}.error.json`)
  if (existsSync(file)) writeFileSync(file, `${JSON.stringify({ attempt: index, clearedAt: now(), error: null, note: 'superseded by a parsed verdict' }, null, 2)}\n`)
}

// ------------------------------------------------------------- commands ---

export function bundleForAttempt(runId, attempt) {
  const bundle = buildRunBundle({ run: runId, attempt, json: false, report: null, source: null })
  const report = bundle.attempts[0]
  return {
    text: markdown(bundle),
    revision: report?.source?.provenance?.revision ?? null,
    citations: report?.summary ?? null,
  }
}

/**
 * Review every attempt that does not already carry a valid verdict.
 *
 * Independence is enforced here, not in the prompt: the reviewer model must
 * differ from the model that produced the report, because a model grading its
 * own homework is not a second opinion.
 */
// The last four parameters are seams for the gate tests (stalker 1609): they
// let the write-or-sidecar decision be exercised end to end without the real
// Copilot CLI. Production never passes them.
export async function runReview({ runId, runDir, attempts, config, allowSameModel = false, only = null, secrets = [], log = console.log, resolveBinary = copilotExecutable, listModels = listCopilotModels, buildBundle = bundleForAttempt, dispatchReviewer = dispatchCopilotReview }) {
  if (only !== null && !attempts.some(attempt => attempt.index === only)) throw new Error(`attempt ${only} does not exist in run ${runId}`)
  const existing = loadVerdicts(runDir)
  const targets = attempts.filter(attempt => (only === null || attempt.index === only) && !existing.get(attempt.index)?.ok)
  if (!targets.length) {
    log(`Every requested attempt of ${runId} already has a stored review verdict.`)
    return { reviewed: 0, failures: [] }
  }
  const sameModel = targets.filter(attempt => attempt.model === config.model)
  if (sameModel.length && !allowSameModel) {
    throw new Error(`reviewer model ${config.model} is the mission model for attempt(s) ${sameModel.map(a => a.index).join(', ')}; an independent review needs a different model (pass --allow-same-model to override, which is recorded in the verdict)`)
  }
  const binary = resolveBinary()
  const models = await listModels(binary)
  if (!models.some(model => model.id === config.model)) {
    throw new Error(`reviewer model ${config.model} is not available to this Copilot account; run probe-copilot-models.mjs to list valid IDs`)
  }
  const failures = []
  let reviewed = 0
  for (const attempt of targets) {
    const index = attempt.index
    log(`[${now()}] reviewing attempt ${pad(index)}/${pad(attempts.length)} with ${config.engine}:${config.model}`)
    // One unbuildable package must not abort the review of every other
    // attempt; it is recorded as unreviewed and the sweep continues.
    let bundle
    try {
      bundle = buildBundle(runId, index)
    } catch (err) {
      const stamp = now()
      const error = `reviewer package could not be built: ${errorMessage(err)}`
      writeError(runDir, index, { attempt: index, runId, error, raw: null, reviewer: { engine: config.engine, model: config.model, missionModel: attempt.model ?? null, startedAt: stamp, finishedAt: stamp }, recordedAt: stamp })
      failures.push({ attempt: index, error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${error}`)
      continue
    }
    assertNoSecret(secrets, `review bundle for attempt ${index}`, bundle.text)
    // A report that the credential rule blanked, or that lost its marker, has
    // nothing for a reviewer to judge; refuse before paying for a dispatch.
    if (typeof attempt.marker === 'string' && attempt.marker && !bundle.text.includes(attempt.marker)) {
      const stamp = now()
      const error = `reviewer package for attempt ${index} does not contain the report marker ${attempt.marker}; the report text was suppressed or replaced, so there is nothing to review by dispatch (use "review --import" after an out-of-band review)`
      writeError(runDir, index, { attempt: index, runId, error, raw: null, reviewer: { engine: config.engine, model: config.model, missionModel: attempt.model ?? null, startedAt: stamp, finishedAt: stamp }, recordedAt: stamp })
      failures.push({ attempt: index, error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${error}`)
      continue
    }
    mkdirSync(reviewsDir(runDir), { recursive: true })
    writeFileSync(join(reviewsDir(runDir), `${pad(index)}.bundle.md`), bundle.text)
    const { text: prompt, receipt } = buildReviewPrompt({ runId, attempt: index, bundleText: bundle.text, revision: bundle.revision })
    const reviewerBase = {
      engine: config.engine,
      model: config.model,
      effort: config.effort,
      context: config.context,
      missionModel: attempt.model ?? null,
      // Recorded, not inferred: a reviewer that shares the mission's model only
      // gets here because the operator passed --allow-same-model, and the
      // verdict must carry that admission with it.
      allowSameModel: allowSameModel === true,
      sameModelAsMission: attempt.model === config.model,
      promptDelivery: 'stdin',
    }
    // Fail closed rather than truncate. A bundle the reviewer cannot hold in
    // context is not reviewed by it at all; the operator routes it through --import.
    if (!promptFits(prompt)) {
      const stamp = now()
      const error = `reviewer prompt for attempt ${index} is ${prompt.length} characters, above the ${MAX_PROMPT_CHARS} stdin limit; review it out of band and ingest the verdict with "review --import"`
      writeError(runDir, index, { attempt: index, runId, error, raw: null, reviewer: { ...reviewerBase, startedAt: stamp, finishedAt: stamp }, recordedAt: stamp })
      failures.push({ attempt: index, error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${error}`)
      continue
    }
    // Outside the git working tree by construction: Copilot restricts file
    // access to the cwd subtree, so a scratch under the OS temp root is what
    // keeps the reviewer away from runner.env.bat, .env.local and the repo.
    const scratchDir = mkdtempSync(join(tmpdir(), `aeon-review-${pad(index)}-`))
    // The usage file is provenance evidence, so it lives in a sibling directory
    // the reviewer's cwd-scoped file access cannot reach.
    const usageDir = mkdtempSync(join(tmpdir(), `aeon-review-usage-${pad(index)}-`))
    let dispatch
    try {
      dispatch = await dispatchReviewer({
        binary,
        model: config.model,
        effort: config.effort,
        context: config.context,
        stdinText: prompt,
        cwd: scratchDir,
        maxAiCredits: config.maxAiCredits,
        timeoutMs: config.timeoutMs,
        usageFile: join(usageDir, 'usage.json'),
      })
    } finally {
      for (const dir of [scratchDir, usageDir]) {
        try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch (err) {
          log(`  attempt ${pad(index)}: reviewer scratch ${dir} could not be removed: ${errorMessage(err)}`)
        }
      }
    }
    const rawText = `${dispatch.stdout}${dispatch.stderr ? `\n----- stderr -----\n${dispatch.stderr}` : ''}`
    assertNoSecret(secrets, `reviewer output for attempt ${index}`, rawText)
    if (dispatch.usage) assertNoSecret(secrets, `reviewer usage for attempt ${index}`, dispatch.usage)
    const rawPath = writeRaw(runDir, index, rawText)
    const reviewer = {
      ...reviewerBase,
      startedAt: dispatch.startedAt,
      finishedAt: dispatch.finishedAt,
      observedModel: dispatch.observedModel,
      // The raw usage file is deleted with the scratch directory; keep it so a
      // provenance failure can be diagnosed from the record alone.
      usage: dispatch.usage ?? null,
      exitCode: dispatch.status,
      timedOut: dispatch.timedOut,
    }
    if (dispatch.timedOut || dispatch.spawnError || dispatch.status !== 0) {
      const error = dispatch.timedOut
        ? `reviewer exceeded its ${config.timeoutMs}ms budget; its process tree was killed`
        : dispatch.spawnError ?? `reviewer exited ${String(dispatch.status)}${dispatch.signal ? ` (${dispatch.signal})` : ''}`
      writeError(runDir, index, { attempt: index, runId, error, raw: rawPath, reviewer, recordedAt: now() })
      failures.push({ attempt: index, error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${error}`)
      continue
    }
    // Enforced, not merely recorded: a verdict from a model we did not ask for
    // is not the independent review the gate claims to have obtained.
    const provenance = modelProvenanceError({
      observedModel: dispatch.observedModel,
      configuredModel: config.model,
      missionModel: attempt.model,
      allowSameModel,
    })
    if (provenance) {
      writeError(runDir, index, { attempt: index, runId, error: provenance, raw: rawPath, reviewer, recordedAt: now() })
      failures.push({ attempt: index, error: provenance })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${provenance}`)
      continue
    }
    const parsed = parseVerdictText(dispatch.stdout)
    if (!parsed.ok) {
      writeError(runDir, index, { attempt: index, runId, error: parsed.error, raw: rawPath, reviewer, recordedAt: now() })
      failures.push({ attempt: index, error: parsed.error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${parsed.error}`)
      continue
    }
    let payload
    try { payload = validateVerdictPayload(parsed.value) } catch (err) {
      const error = `verdict failed schema validation: ${errorMessage(err)}`
      writeError(runDir, index, { attempt: index, runId, error, raw: rawPath, reviewer, recordedAt: now() })
      failures.push({ attempt: index, error })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${error}`)
      continue
    }
    const echoError = receiptEchoError(parsed.value, receipt)
    if (echoError) {
      writeError(runDir, index, { attempt: index, runId, error: echoError, raw: rawPath, reviewer, recordedAt: now() })
      failures.push({ attempt: index, error: echoError })
      log(`  attempt ${pad(index)}: NOT REVIEWED — ${echoError}`)
      continue
    }
    const record = {
      attempt: index,
      runId,
      marker: attempt.marker ?? null,
      receipt,
      verdict: payload.verdict,
      findings: payload.findings,
      summary: payload.summary,
      reviewer,
      bundle: {
        path: `reviews/${pad(index)}.bundle.md`,
        sha256: createHash('sha256').update(bundle.text).digest('hex'),
        revision: bundle.revision,
        citations: bundle.citations,
      },
      raw: rawPath,
      schemaNotes: payload.schemaNotes,
      recordedAt: now(),
    }
    writeRecord(runDir, index, record)
    clearError(runDir, index)
    reviewed += 1
    log(`  attempt ${pad(index)}: ${payload.verdict}${payload.findings.length ? ` (${payload.findings.length} finding(s))` : ''}`)
  }
  return { reviewed, failures }
}

/**
 * Ingest a verdict produced elsewhere — a human, or another agent.
 *
 * This path is the softest part of the gate, so it is the most constrained: an
 * import that could silently replace a stored FAIL with a hand-written PASS
 * would hand the whole gate back to whoever runs the command.
 */
export function importVerdict({ runId, runDir, attempts, file, attempt = null, secrets = [], force = false }) {
  const path = resolve(file)
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`verdict file was not found: ${path}`)
  const text = readFileSync(path, 'utf8')
  assertNoSecret(secrets, `imported verdict ${path}`, text)
  const parsed = parseVerdictText(text)
  if (!parsed.ok) throw new Error(`imported verdict could not be read: ${parsed.error}`)
  const index = attempt ?? (Number.isInteger(parsed.value?.attempt) ? parsed.value.attempt : null)
  if (!Number.isInteger(index) || index < 1) throw new Error('pass --attempt=N, or give the verdict file a positive integer "attempt" field')
  // A verdict that names its own subject must be believed about it: only an
  // absent field is stamped, a stated one is checked and never rewritten.
  if (parsed.value?.attempt !== undefined) {
    if (!Number.isInteger(parsed.value.attempt) || parsed.value.attempt < 1) {
      throw new Error(`verdict file "attempt" must be a positive integer, received ${JSON.stringify(parsed.value.attempt)}`)
    }
    if (parsed.value.attempt !== index) throw new Error(`verdict file names attempt ${parsed.value.attempt} but attempt ${index} was requested`)
  }
  if (parsed.value?.runId !== undefined) {
    if (typeof parsed.value.runId !== 'string') throw new Error(`verdict file "runId" must be a string, received ${JSON.stringify(parsed.value.runId)}`)
    if (parsed.value.runId !== runId) throw new Error(`verdict file names run ${JSON.stringify(parsed.value.runId)} but the prepared run is ${runId}`)
  }
  const target = attempts.find(candidate => candidate.index === index)
  if (!target) throw new Error(`attempt ${index} does not exist in run ${runId}`)
  const payload = validateVerdictPayload(parsed.value)
  const existingPath = join(reviewsDir(runDir), `${pad(index)}.json`)
  if (existsSync(existingPath)) {
    const priorText = readFileSync(existingPath, 'utf8')
    let priorVerdict = null
    try { priorVerdict = validateVerdictRecord(JSON.parse(priorText)).verdict } catch { /* unparsable: still evidence */ }
    // Closed route, no flag. Overwriting a recorded PASS_WITH_CORRECTIONS or
    // FAIL with a PASS is the one edit that would let a run reach `passed`
    // with the disqualifying verdict erased from the record.
    if (priorVerdict !== null && priorVerdict !== 'PASS' && payload.verdict === 'PASS') {
      throw new Error(`attempt ${index} already holds a ${priorVerdict} verdict; an import may never replace a non-PASS verdict with a PASS. Re-run the batch instead.`)
    }
    if (!force) {
      throw new Error(`attempt ${index} already holds a ${priorVerdict ?? 'stored but unparsable'} verdict at ${existingPath}; pass --force to supersede it (the previous verdict is archived, not deleted)`)
    }
    const archived = join(reviewsDir(runDir), `${pad(index)}.superseded-${now().replace(/[:.]/g, '-')}.json`)
    renameSync(existingPath, archived)
  }
  const supplied = parsed.value?.reviewer && typeof parsed.value.reviewer === 'object' ? parsed.value.reviewer : {}
  const stamp = now()
  const reviewer = validateReviewer({
    ...supplied,
    engine: 'import',
    model: typeof supplied.model === 'string' && supplied.model.trim() ? supplied.model : 'unspecified',
    startedAt: typeof supplied.startedAt === 'string' && supplied.startedAt.trim() ? supplied.startedAt : stamp,
    finishedAt: typeof supplied.finishedAt === 'string' && supplied.finishedAt.trim() ? supplied.finishedAt : stamp,
    missionModel: target.model ?? null,
    declaredEngine: typeof supplied.engine === 'string' ? supplied.engine : null,
    importedFrom: path,
  })
  const record = {
    attempt: index,
    runId,
    verdict: payload.verdict,
    findings: payload.findings,
    summary: payload.summary,
    reviewer,
    raw: writeRaw(runDir, index, text, 'import'),
    schemaNotes: payload.schemaNotes,
    recordedAt: stamp,
  }
  writeRecord(runDir, index, record)
  clearError(runDir, index)
  return record
}
