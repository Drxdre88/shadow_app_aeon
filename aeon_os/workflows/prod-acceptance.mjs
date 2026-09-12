#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ENV_FILE = join(ROOT, 'apps', 'kairos-worker', 'runner.env.bat')
const HANGAR_VALIDATOR = join(ROOT, 'apps', 'web', 'src', 'lib', 'data', 'validators', 'hangar.ts')
const PROOF_DIR = join(HERE, 'results', '2026-09-11T12-17-25-014Z-1a3691')
const TARGET_ORIGIN = 'https://aeon.shadow-lab.ai'
const PROJECT_ID = 'e4b0af95-d3ad-46ba-8275-1ecc28911683'
const TERMINAL = new Set(['succeeded', 'failed', 'killed', 'timeout'])
const LIVE = new Set(['queued', 'running'])
const USAGE = 'Usage: node --use-system-ca aeon_os/workflows/prod-acceptance.mjs [--json]'
const CHECK_NAMES = [
  'No Authorization header',
  'Garbage bearer token',
  'Non-existent project boundary',
  'Invalid project-id handling',
  'Missing create-session fields',
  'Invalid session engine',
  'Invalid Hangar objective',
  'Oversized prompt handling',
  'Injection-like prompt round-trip',
  'Concurrent duplicate launch guard',
  'Queued-session cancellation lifecycle',
  'Already-terminal kill idempotency',
  'Non-existent session kill',
  'Result-envelope delivery contract',
  'Ten-card read-surface integrity',
]

function parseArgs(argv) {
  if (argv.length === 0) return { json: false }
  if (argv.length === 1 && argv[0] === '--json') return { json: true }
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true }
  throw new Error(`Unknown argument.\n${USAGE}`)
}

function parseEnv() {
  const allowed = new Set(['AEON_BASE_URL', 'KAIROS_AEON_API_KEY'])
  const parsed = {}
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const match = /^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/i.exec(line)
      if (match && allowed.has(match[1].toUpperCase())) parsed[match[1].toUpperCase()] = match[2].trim()
    }
  }
  const cfg = {
    baseUrl: (process.env.AEON_BASE_URL || parsed.AEON_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.KAIROS_AEON_API_KEY || parsed.KAIROS_AEON_API_KEY || '',
  }
  if (cfg.baseUrl !== TARGET_ORIGIN) throw new Error(`AEON_BASE_URL must be exactly ${TARGET_ORIGIN}`)
  if (!cfg.apiKey) throw new Error('KAIROS_AEON_API_KEY is missing')
  return cfg
}

function loadProofs() {
  const files = readdirSync(PROOF_DIR)
    .filter((name) => /^attempt-\d{2}\.json$/.test(name))
    .sort()
  if (files.length !== 10) throw new Error(`Expected 10 attempt files, found ${files.length}`)
  return files.map((name) => {
    const value = JSON.parse(readFileSync(join(PROOF_DIR, name), 'utf8'))
    if (value.projectId !== PROJECT_ID) throw new Error(`${name} belongs to an unexpected project`)
    if (!value.taskId || !value.marker) throw new Error(`${name} has no taskId or marker`)
    return { attempt: value.attempt, taskId: value.taskId, marker: value.marker }
  })
}

function inspectHangarContract() {
  const source = readFileSync(HANGAR_VALIDATOR, 'utf8')
  const objectivesBlock = /hangarObjectiveSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/.exec(source)?.[1]
  if (!objectivesBlock) throw new Error('Could not locate hangarObjectiveSchema')
  const objectives = [...objectivesBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])

  const start = source.indexOf('export const hangarResultEnvelopeSchema = z.object({')
  const envelopeTail = start < 0 ? '' : source.slice(start)
  const endMatch = /\r?\n\}\)\r?\n\r?\nexport const createHangarRepoSchema/.exec(envelopeTail)
  const end = endMatch ? start + endMatch.index : -1
  if (start < 0 || end < 0) throw new Error('Could not locate hangarResultEnvelopeSchema')
  const block = source.slice(start, end)
  const declarations = [...block.matchAll(/^  ([a-z_]+):/gm)]
  const fields = declarations.map((match, index) => {
    const next = declarations[index + 1]
    const definition = block.slice(match.index, next?.index ?? block.length)
    return { name: match[1], optional: /\.optional\(\)/.test(definition) }
  })
  const mandatory = fields.filter((field) => !field.optional).map((field) => field.name)
  const optional = fields.filter((field) => field.optional).map((field) => field.name)
  const deliverables = ['branch', 'commit', 'artifacts']
  if (
    objectives.length === 0
    || mandatory.join(',') !== 'status,outcome,summary'
    || !deliverables.every((field) => optional.includes(field))
  ) {
    throw new Error('Hangar validator contract changed; review this acceptance check before production use')
  }
  return {
    objectives,
    mandatory,
    optional,
    summaryAllowsEmpty: /summary:\s+z\.string\(\)\.trim\(\)\.max\(8000\)/.test(block),
    hasObjectiveSpecificResultRules: /\.superRefine\(|\.refine\(/.test(block),
  }
}

function nowToken() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function redact(cfg, value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return ''
  text = text.split(cfg.apiKey).join('[REDACTED]')
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
}

function excerpt(cfg, text, needle = '') {
  const safe = redact(cfg, text).replace(/\s+/g, ' ').trim()
  if (!safe) return '(empty body)'
  const at = needle ? safe.indexOf(needle) : -1
  const start = at < 0 ? 0 : Math.max(0, at - 80)
  const picked = safe.slice(start, start + 320)
  return `${start > 0 ? '…' : ''}${picked}${start + 320 < safe.length ? '…' : ''}`
}

function hasStackTrace(text) {
  return /\b(?:node:internal|at\s+(?:async\s+)?[\w.[\]<>]+\s*\(|Error:\s.*\n\s*at\s|\/(?:var|usr|app)\/[^ \n]+:\d+:\d+|[A-Za-z]:\\[^ \n]+:\d+:\d+)/i.test(text)
}

function safeErrorBody(cfg, response) {
  return !response.text.includes(cfg.apiKey) && !hasStackTrace(response.text)
}

async function request(cfg, path, init = {}) {
  const method = init.method ?? 'GET'
  const headers = { Accept: 'application/json' }
  if (init.auth === undefined || init.auth === 'valid') headers.Authorization = `Bearer ${cfg.apiKey}`
  else if (init.auth !== null) headers.Authorization = `Bearer ${init.auth}`
  let body
  if (init.rawBody !== undefined) {
    body = init.rawBody
    headers['Content-Type'] = 'application/json'
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body)
    headers['Content-Type'] = 'application/json'
  }
  const started = Date.now()
  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeout ?? 20_000),
    })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* Evidence retains the text. */ }
    return { status: response.status, text, json, durationMs: Date.now() - started, transportError: null }
  } catch (error) {
    return {
      status: null,
      text: '',
      json: null,
      durationMs: Date.now() - started,
      transportError: errorMessage(error),
    }
  }
}

function dataOf(response) {
  return response?.json && typeof response.json === 'object' && Object.hasOwn(response.json, 'data')
    ? response.json.data
    : response?.json
}

function responseEvidence(cfg, response, needle = '') {
  return {
    status: response.status ?? 'NO_RESPONSE',
    durationMs: response.durationMs,
    bodyExcerpt: response.transportError
      ? `Transport error: ${redact(cfg, response.transportError)}`
      : excerpt(cfg, response.text, needle),
  }
}

function sessionFrom(response) {
  return dataOf(response)?.session ?? null
}

function sessionBody(prefix, overrides = {}) {
  return {
    engine: 'copilot',
    goal: `${prefix} contract probe`,
    prompt: 'Production acceptance contract probe. Do not execute.',
    repo: 'aeon-os-test',
    branch: null,
    projectId: PROJECT_ID,
    taskId: null,
    metadata: { hangar: { objective: 'analysis' } },
    ...overrides,
  }
}

function cardBody(prefix, suffix, columnId) {
  return {
    name: `${prefix} ${suffix}`,
    description: 'Temporary production acceptance card; safe to delete.',
    columnId,
    status: 'todo',
    priority: 'medium',
    color: 'purple',
    onTimeline: false,
    metadata: {
      hangar: {
        objective: 'analysis',
        repo: 'aeon-os-test',
        agent: 'copilot',
        model: null,
        instruction: 'Production acceptance contract probe. Do not execute.',
        outputMode: 'auto',
        autoRun: false,
        subagents: [],
        sessionIds: [],
      },
    },
  }
}

function formatStatuses(responses) {
  return responses.map((response) => response.status ?? 'NO_RESPONSE').join(', ')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  if (!process.execArgv.includes('--use-system-ca')) {
    throw new Error(`Refusing production traffic without --use-system-ca.\n${USAGE}`)
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'

  const cfg = parseEnv()
  const proofs = loadProofs()
  const hangarContract = inspectHangarContract()
  const runId = nowToken()
  const prefix = `PROD_ACCEPTANCE_${runId}`
  const checks = []
  const sessionIds = new Set()
  const cardIds = new Set()
  let columns = []
  let baselineCards = []
  let lifecycleSessionId = null
  let cleanupReport = { ok: false, observed: 'Cleanup did not run', cards: [] }

  function addCheck(number, expected, result) {
    checks.push({
      number,
      name: CHECK_NAMES[number - 1],
      result: result.skipped ? 'SKIPPED' : result.ok ? 'PASS' : 'FAIL',
      expected,
      observed: result.observed,
      evidence: result.evidence ?? [],
    })
  }

  async function runCheck(number, expected, fn) {
    try {
      addCheck(number, expected, await fn())
    } catch (error) {
      addCheck(number, expected, {
        ok: false,
        observed: `Check error: ${redact(cfg, errorMessage(error))}`,
        evidence: [],
      })
    }
  }

  function trackSession(response) {
    const session = sessionFrom(response)
    if (session?.id) sessionIds.add(session.id)
    return session
  }

  async function killIfLive(id) {
    if (!id) return null
    const current = await request(cfg, `/api/v1/sessions/${id}`)
    const session = dataOf(current)
    if (current.status === 200 && LIVE.has(session?.status)) {
      return request(cfg, `/api/v1/sessions/${id}/kill`, { method: 'POST', body: {} })
    }
    return current
  }

  async function createCard(suffix) {
    const queued = columns.find((column) => column.name?.trim().toLowerCase() === 'queued')
      ?? columns.find((column) => column.name?.trim().toLowerCase() !== 'landing')
    if (!queued?.id) throw new Error('No safe non-Landing column is available for temporary cards')
    const response = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks`, {
      method: 'POST',
      body: cardBody(prefix, suffix, queued.id),
    })
    const card = dataOf(response)
    if (response.status !== 201 || !card?.id || card.projectId !== PROJECT_ID) {
      throw new Error(`Temporary card creation returned ${response.status ?? 'no response'}`)
    }
    cardIds.add(card.id)
    return { response, card }
  }

  async function listCards(retries = 0) {
    let response
    for (let attempt = 0; attempt <= retries; attempt++) {
      response = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks?limit=500`)
      if (response.status === 200) break
      if (attempt < retries) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    }
    return { response, cards: Array.isArray(dataOf(response)) ? dataOf(response) : [] }
  }

  async function cleanup() {
    const errors = []

    const listedSessions = await request(
      cfg,
      `/api/v1/sessions?projectId=${PROJECT_ID}&limit=100&offset=0`,
    )
    if (listedSessions.status === 200) {
      for (const session of dataOf(listedSessions)?.sessions ?? []) {
        if (typeof session.goal === 'string' && session.goal.startsWith(prefix)) sessionIds.add(session.id)
      }
    } else {
      errors.push(`session reconciliation returned ${listedSessions.status ?? 'no response'}`)
    }

    for (const id of sessionIds) {
      const result = await killIfLive(id)
      if (!result || ![200, 404].includes(result.status)) {
        errors.push(`could not settle session ${id} (${result?.status ?? 'no response'})`)
      }
    }

    const beforeDelete = await listCards(2)
    if (beforeDelete.response.status === 200) {
      for (const card of beforeDelete.cards) {
        if (typeof card.name === 'string' && card.name.startsWith(prefix)) cardIds.add(card.id)
      }
    } else {
      errors.push(`card reconciliation returned ${beforeDelete.response.status ?? 'no response'}`)
    }

    for (const id of cardIds) {
      const response = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks/${id}`, {
        method: 'DELETE',
      })
      if (![200, 404].includes(response.status)) {
        errors.push(`could not delete temporary card ${id} (${response.status ?? 'no response'})`)
      }
    }

    const final = await listCards(2)
    if (final.response.status !== 200) errors.push(`final card list returned ${final.response.status ?? 'no response'}`)
    const temporaryRemaining = final.cards.filter((card) => cardIds.has(card.id) || card.name?.startsWith(prefix))
    if (temporaryRemaining.length) errors.push(`${temporaryRemaining.length} temporary card(s) remain`)

    const missionState = proofs.map((proof) => {
      const card = final.cards.find((candidate) => candidate.id === proof.taskId)
      return {
        taskId: proof.taskId,
        present: Boolean(card),
        landing: columns.some((column) => (
          column.id === card?.columnId && column.name?.trim().toLowerCase() === 'landing'
        )),
        completed: card?.metadata?.hangar?.lastResult?.status === 'completed',
        markerPresent: String(card?.metadata?.hangar?.lastResult?.summary ?? '').includes(proof.marker),
      }
    })
    if (missionState.some((state) => !state.present || !state.landing || !state.completed || !state.markerPresent)) {
      errors.push('one or more of the 10 mission cards changed or disappeared')
    }

    const unsettled = []
    for (const id of sessionIds) {
      const response = await request(cfg, `/api/v1/sessions/${id}`)
      const session = dataOf(response)
      if (response.status === 200 && !TERMINAL.has(session?.status)) unsettled.push(id)
      else if (![200, 404].includes(response.status)) errors.push(`could not verify session ${id}`)
    }
    if (unsettled.length) errors.push(`${unsettled.length} temporary session(s) are still live`)

    return {
      ok: errors.length === 0,
      observed: errors.length
        ? errors.join('; ')
        : `0 temporary cards remain; ${sessionIds.size} temporary session(s) terminal; all 10 mission cards intact`,
      temporaryCardIds: [...cardIds],
      temporaryRemaining: temporaryRemaining.map((card) => card.id),
      missionState,
      cards: final.cards.map((card) => ({ id: card.id, name: card.name })),
      evidence: [responseEvidence(cfg, final.response)],
    }
  }

  try {
    const project = await request(cfg, `/api/v1/projects/${PROJECT_ID}`)
    const columnsResponse = await request(cfg, `/api/v1/projects/${PROJECT_ID}/columns`)
    const baseline = await listCards()
    columns = Array.isArray(dataOf(columnsResponse)) ? dataOf(columnsResponse) : []
    baselineCards = baseline.cards
    if (
      project.status !== 200
      || dataOf(project)?.id !== PROJECT_ID
      || columnsResponse.status !== 200
      || baseline.response.status !== 200
      || !columns.some((column) => column.name?.trim().toLowerCase() === 'landing')
    ) {
      const reason = `Safe setup failed (project=${project.status}, columns=${columnsResponse.status}, cards=${baseline.response.status})`
      for (let number = 1; number <= 15; number++) {
        addCheck(number, 'Production check prerequisites available', {
          skipped: true,
          observed: reason,
          evidence: [
            responseEvidence(cfg, project),
            responseEvidence(cfg, columnsResponse),
            responseEvidence(cfg, baseline.response),
          ],
        })
      }
    } else {
      await runCheck(1, 'GET without Authorization returns 401; no credential or stack trace', async () => {
        const response = await request(cfg, `/api/v1/projects/${PROJECT_ID}`, { auth: null })
        return {
          ok: response.status === 401 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}; safeBody=${safeErrorBody(cfg, response)}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(2, 'GET with a garbage bearer token returns 401; no credential or stack trace', async () => {
        const response = await request(cfg, `/api/v1/projects/${PROJECT_ID}`, {
          auth: `garbage-${randomBytes(12).toString('hex')}`,
        })
        return {
          ok: response.status === 401 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}; safeBody=${safeErrorBody(cfg, response)}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(3, 'Unknown UUID returns 403/404, never 500 or project data', async () => {
        const response = await request(cfg, `/api/v1/projects/${randomUUID()}`)
        const leakedData = Boolean(dataOf(response)?.id || dataOf(response)?.name)
        return {
          ok: [403, 404].includes(response.status) && !leakedData && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}; dataLeak=${leakedData}; safeBody=${safeErrorBody(cfg, response)}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(4, 'Both traversal-like and non-UUID project ids return a clean 4xx, never 500', async () => {
        const ids = ['../../etc', 'not-a-uuid']
        const responses = await Promise.all(ids.map((id) => (
          request(cfg, `/api/v1/projects/${encodeURIComponent(id)}`)
        )))
        const ok = responses.every((response) => (
          response.status >= 400
          && response.status < 500
          && safeErrorBody(cfg, response)
        ))
        return {
          ok,
          observed: `HTTP [${formatStatuses(responses)}]; allClean4xx=${ok}`,
          evidence: responses.map((response) => responseEvidence(cfg, response)),
        }
      })

      await runCheck(5, 'Create session with missing required fields returns 400', async () => {
        const response = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          body: { projectId: PROJECT_ID },
        })
        trackSession(response)
        return {
          ok: response.status === 400 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(6, 'Create session with an unknown engine returns a clean 4xx', async () => {
        const response = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          body: sessionBody(prefix, { engine: 'definitely-not-an-engine' }),
        })
        trackSession(response)
        return {
          ok: response.status >= 400 && response.status < 500 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(7, `Objective outside [${hangarContract.objectives.join(', ')}] returns a clean 4xx`, async () => {
        const response = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          body: sessionBody(prefix, {
            goal: `${prefix} invalid-objective probe`,
            metadata: { hangar: { objective: 'launch_the_moon' } },
          }),
        })
        const session = trackSession(response)
        if (session?.id) await killIfLive(session.id)
        return {
          ok: response.status >= 400 && response.status < 500 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}; sessionCreated=${Boolean(session?.id)}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(8, 'A roughly 2 MiB prompt returns 4xx/413 within 30s, never 500', async () => {
        const body = sessionBody(prefix, {
          goal: `${prefix} oversized-prompt probe`,
          prompt: 'X'.repeat(2 * 1024 * 1024),
        })
        const response = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          rawBody: JSON.stringify(body),
          timeout: 30_000,
        })
        const session = trackSession(response)
        if (session?.id) await killIfLive(session.id)
        const clean = response.status >= 400 && response.status < 500 && safeErrorBody(cfg, response)
        return {
          ok: clean,
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'} in ${response.durationMs}ms; clean4xx=${clean}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(9, 'SQL/script-like prompt is stored verbatim, returned safely, stays queued, then is killed', async () => {
        const marker = `${prefix}_INJECTION_MARKER`
        const prompt = `${marker}'; DROP TABLE agent_sessions; -- <script>globalThis.pwned=true</script> {{7*7}}`
        const created = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          body: sessionBody(prefix, { goal: `${prefix} injection-roundtrip probe`, prompt }),
        })
        const session = trackSession(created)
        const fetched = session?.id
          ? await request(cfg, `/api/v1/sessions/${session.id}`)
          : { status: null, text: '', json: null, durationMs: 0, transportError: 'No session id returned' }
        const stored = dataOf(fetched)
        const killed = session?.id ? await killIfLive(session.id) : fetched
        const safeQueued = created.status === 201
          && session?.status === 'queued'
          && dataOf(created)?.dispatched === false
          && fetched.status === 200
          && stored?.prompt === prompt
        return {
          ok: safeQueued && killed.status === 200 && dataOf(killed)?.session?.status === 'killed',
          observed: `create=${created.status}; dispatched=${String(dataOf(created)?.dispatched)}; queued=${session?.status === 'queued'}; exactRoundTrip=${stored?.prompt === prompt}; kill=${killed.status}`,
          evidence: [
            responseEvidence(cfg, created, marker),
            responseEvidence(cfg, fetched, marker),
            responseEvidence(cfg, killed),
          ],
        }
      })

      await runCheck(10, 'Four concurrent launches create exactly one queued session; three return clear duplicate 4xx errors', async () => {
        const { response: cardResponse, card } = await createCard('DUPLICATE_GUARD')
        const body = sessionBody(prefix, {
          goal: `${prefix} duplicate-guard probe`,
          taskId: card.id,
        })
        let responses = []
        let liveResponse = null
        let live = []
        let afterKill = null
        try {
          responses = await Promise.all(Array.from({ length: 4 }, () => (
            request(cfg, '/api/v1/sessions', { method: 'POST', body })
          )))
          for (const response of responses) trackSession(response)
          liveResponse = await request(
            cfg,
            `/api/v1/sessions?projectId=${PROJECT_ID}&liveOnly=true&limit=100&offset=0`,
          )
          live = (dataOf(liveResponse)?.sessions ?? []).filter((session) => session.taskId === card.id)
          for (const session of live) sessionIds.add(session.id)
          const successes = responses.filter((response) => response.status === 201)
          const rejected = responses.filter((response) => response.status !== 201)
          const clearDuplicates = rejected.filter((response) => (
            response.status >= 400
            && response.status < 500
            && /already has a live mission|duplicate|kill it before launching/i.test(response.text)
          ))
          const queued = live.filter((session) => session.status === 'queued')
          const noDispatch = successes.every((response) => dataOf(response)?.dispatched === false)
          for (const session of live) await killIfLive(session.id)
          afterKill = await request(
            cfg,
            `/api/v1/sessions?projectId=${PROJECT_ID}&liveOnly=true&limit=100&offset=0`,
          )
          const remaining = (dataOf(afterKill)?.sessions ?? []).filter((session) => session.taskId === card.id)
          const ok = successes.length === 1
            && rejected.length === 3
            && clearDuplicates.length === 3
            && live.length === 1
            && queued.length === 1
            && noDispatch
            && remaining.length === 0
          return {
            ok,
            observed: `POST [${formatStatuses(responses)}]; created=${successes.length}; live=${live.length}; queued=${queued.length}; clearDuplicate4xx=${clearDuplicates.length}/${rejected.length}; remainingAfterKill=${remaining.length}`,
            evidence: [
              responseEvidence(cfg, cardResponse),
              ...responses.map((response) => responseEvidence(cfg, response)),
              responseEvidence(cfg, liveResponse),
              responseEvidence(cfg, afterKill),
            ],
          }
        } finally {
          for (const session of live) await killIfLive(session.id)
          const deleted = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks/${card.id}`, {
            method: 'DELETE',
          })
          if (deleted.status === 200 || deleted.status === 404) cardIds.delete(card.id)
        }
      })

      await runCheck(11, 'Queued session kills to terminal killed, disappears from live/claimable list, and card is not running', async () => {
        const { response: cardResponse, card } = await createCard('CANCELLATION')
        const created = await request(cfg, '/api/v1/sessions', {
          method: 'POST',
          body: sessionBody(prefix, {
            goal: `${prefix} cancellation-lifecycle probe`,
            taskId: card.id,
          }),
        })
        const session = trackSession(created)
        lifecycleSessionId = session?.id ?? null
        const killed = session?.id
          ? await request(cfg, `/api/v1/sessions/${session.id}/kill`, { method: 'POST', body: {} })
          : created
        const reread = session?.id
          ? await request(cfg, `/api/v1/sessions/${session.id}`)
          : created
        const liveResponse = await request(
          cfg,
          `/api/v1/sessions?projectId=${PROJECT_ID}&liveOnly=true&limit=100&offset=0`,
        )
        const cardRead = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks/${card.id}`)
        const liveIds = (dataOf(liveResponse)?.sessions ?? []).map((row) => row.id)
        const cardValue = dataOf(cardRead)
        const cardShowsRunning = cardValue?.metadata?.hangar?.status === 'running'
          || cardValue?.metadata?.hangar?.lastResult?.status === 'running'
        const ok = created.status === 201
          && dataOf(created)?.dispatched === false
          && session?.status === 'queued'
          && killed.status === 200
          && dataOf(killed)?.session?.status === 'killed'
          && dataOf(reread)?.status === 'killed'
          && !liveIds.includes(session?.id)
          && !cardShowsRunning
        return {
          ok,
          observed: `create=${created.status}/${session?.status}; dispatched=${String(dataOf(created)?.dispatched)}; kill=${killed.status}/${dataOf(killed)?.session?.status}; reread=${dataOf(reread)?.status}; liveListContains=${liveIds.includes(session?.id)}; cardRunning=${cardShowsRunning}`,
          evidence: [
            responseEvidence(cfg, cardResponse),
            responseEvidence(cfg, created),
            responseEvidence(cfg, killed),
            responseEvidence(cfg, reread),
            responseEvidence(cfg, liveResponse),
            responseEvidence(cfg, cardRead),
          ],
        }
      })

      await runCheck(12, 'Killing the already-killed lifecycle session is idempotent: 2xx and still killed', async () => {
        if (!lifecycleSessionId) {
          return { skipped: true, observed: 'Check 11 did not produce a session id', evidence: [] }
        }
        const response = await request(cfg, `/api/v1/sessions/${lifecycleSessionId}/kill`, {
          method: 'POST',
          body: {},
        })
        return {
          ok: response.status >= 200
            && response.status < 300
            && dataOf(response)?.session?.status === 'killed'
            && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}; status=${dataOf(response)?.session?.status}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(13, 'Killing a random non-existent session UUID returns a clean 404', async () => {
        const response = await request(cfg, `/api/v1/sessions/${randomUUID()}/kill`, {
          method: 'POST',
          body: {},
        })
        return {
          ok: response.status === 404 && safeErrorBody(cfg, response),
          observed: `HTTP ${response.status ?? 'NO_RESPONSE'}`,
          evidence: [responseEvidence(cfg, response)],
        }
      })

      await runCheck(14, 'Report mandatory/optional result fields and objectives that permit completed with no deliverables', async () => {
        const noDeliverables = hangarContract.objectives
        const finding = `MANDATORY: ${hangarContract.mandatory.join(', ')}. OPTIONAL: ${hangarContract.optional.join(', ')}. BUSINESS RISK: ALL objectives (${noDeliverables.join(', ')}) can report completed with no branch, no commit, and no artifacts${hangarContract.summaryAllowsEmpty ? '; summary is structurally required but may be empty' : ''}.`
        return {
          ok: !hangarContract.hasObjectiveSpecificResultRules && noDeliverables.length === 5,
          observed: finding,
          evidence: [{ status: 'LOCAL_SOURCE', durationMs: 0, bodyExcerpt: finding }],
        }
      })

      await runCheck(15, 'All 10 proof cards are completed, in Landing, and each summary contains its attempt marker', async () => {
        const landing = columns.find((column) => column.name?.trim().toLowerCase() === 'landing')
        const responses = []
        const states = []
        for (const proof of proofs) {
          const response = await request(cfg, `/api/v1/projects/${PROJECT_ID}/tasks/${proof.taskId}`)
          responses.push(response)
          const card = dataOf(response)
          states.push({
            attempt: proof.attempt,
            taskId: proof.taskId,
            http: response.status,
            completed: card?.metadata?.hangar?.lastResult?.status === 'completed',
            landing: card?.columnId === landing?.id,
            marker: String(card?.metadata?.hangar?.lastResult?.summary ?? '').includes(proof.marker),
          })
        }
        const ok = states.every((state) => (
          state.http === 200 && state.completed && state.landing && state.marker
        ))
        return {
          ok,
          observed: states.map((state) => (
            `${state.attempt}:${state.http}/${state.completed ? 'completed' : 'bad-status'}/${state.landing ? 'Landing' : 'wrong-column'}/${state.marker ? 'marker' : 'missing-marker'}`
          )).join(' '),
          evidence: responses.map((response, index) => responseEvidence(cfg, response, proofs[index].marker)),
        }
      })
    }
  } finally {
    cleanupReport = await cleanup().catch((error) => ({
      ok: false,
      observed: `Cleanup error: ${redact(cfg, errorMessage(error))}`,
      cards: [],
      evidence: [],
      missionState: [],
      temporaryCardIds: [...cardIds],
      temporaryRemaining: [...cardIds],
    }))
  }

  const counts = {
    passed: checks.filter((check) => check.result === 'PASS').length,
    failed: checks.filter((check) => check.result === 'FAIL').length,
    skipped: checks.filter((check) => check.result === 'SKIPPED').length,
  }
  const report = {
    target: cfg.baseUrl,
    projectId: PROJECT_ID,
    runId,
    checks,
    summary: { ...counts, total: checks.length, cleanup: cleanupReport.ok ? 'PASS' : 'FAIL' },
    cleanup: cleanupReport,
    baselineCardCount: baselineCards.length,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Aeon production business acceptance — ${runId}`)
    console.log(`Target: ${cfg.baseUrl}  Project: ${PROJECT_ID}`)
    console.log('')
    console.log(' #  RESULT   CHECK                                      OBSERVED')
    console.log('──  ───────  ─────────────────────────────────────────  ────────────────────────────────────────────────────────────')
    for (const check of checks) {
      const observed = check.observed.replace(/\s+/g, ' ')
      console.log(`${String(check.number).padStart(2)}  ${check.result.padEnd(7)}  ${check.name.slice(0, 40).padEnd(40)}  ${observed}`)
    }
    console.log('')
    console.log(`Summary: ${counts.passed} PASS, ${counts.failed} FAIL, ${counts.skipped} SKIPPED (${checks.length} checks); cleanup ${cleanupReport.ok ? 'PASS' : 'FAIL'}`)
    console.log(`Cleanup: ${cleanupReport.observed}`)
    console.log('Final test-project cards:')
    for (const card of cleanupReport.cards) console.log(`  ${card.id}  ${card.name}`)
    console.log('')
    console.log('Evidence:')
    for (const check of checks) {
      console.log(`${check.number}. ${check.result} ${check.name}`)
      console.log(`   Expected: ${check.expected}`)
      console.log(`   Observed: ${check.observed}`)
      for (const item of check.evidence) {
        console.log(`   HTTP ${item.status} (${item.durationMs}ms): ${item.bodyExcerpt}`)
      }
    }
  }

  if (counts.failed > 0 || counts.skipped > 0 || !cleanupReport.ok) process.exitCode = 1
}

main().catch((error) => {
  const message = errorMessage(error)
  console.error(`prod-acceptance failed safely: ${message}`)
  process.exitCode = 1
})
