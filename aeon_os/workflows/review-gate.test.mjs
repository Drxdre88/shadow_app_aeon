// Gate proof: run with `node --test aeon_os/workflows/review-gate.test.mjs`.
//
// These tests feed synthetic verdicts through the real gate logic. They never
// dispatch a reviewer, never touch production, and never read or write the
// durable evidence under results/ — each case builds its own throwaway run
// directory under the OS temp folder, and the CLI cases copy the harness into
// a temp sandbox with its own state.json.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ARCHIVABLE_STATUSES,
  MAX_BUNDLE_CHARS,
  PASS_COMPATIBLE_SEVERITIES,
  archiveDecision,
  buildReviewPrompt,
  evaluateReviewGate,
  importVerdict,
  bundleFits,
  killTree,
  loadVerdicts,
  markerEchoError,
  modelProvenanceError,
  dispatchCopilotReview,
  observedModelFromUsage,
  parseVerdictText,
  reviewConfig,
  reviewerArgs,
  reviewsDir,
  runReview,
  validateVerdictPayload,
  validateVerdictRecord,
} from './review.mjs'
import { extractCitations } from './review-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REVIEWER = { engine: 'copilot', model: 'gpt-5.6-sol', startedAt: '2026-09-12T10:00:00.000Z', finishedAt: '2026-09-12T10:02:00.000Z' }

function attempts(count, model = 'claude-sonnet-5') {
  return Array.from({ length: count }, (_unused, offset) => ({ index: offset + 1, result: 'PASS', model }))
}

function verdictRecord(index, verdict, findings = null) {
  const fallback = verdict === 'PASS' ? [] : [{ claim: 'a claim', cited: 'apps/web/src/x.ts:10', actual: 'the line does something else', severity: 'major' }]
  return { attempt: index, verdict, findings: findings ?? fallback, summary: `synthetic ${verdict}`, reviewer: REVIEWER }
}

function withRunDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-review-gate-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

function writeVerdicts(runDir, records) {
  mkdirSync(reviewsDir(runDir), { recursive: true })
  for (const [index, body] of Object.entries(records)) {
    const name = `${String(index).padStart(2, '0')}.json`
    writeFileSync(join(reviewsDir(runDir), name), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`)
  }
}

// -------------------------------------------------------------- gate logic --

test('every attempt PASS reaches passed', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, Object.fromEntries(attempts(10).map(a => [a.index, verdictRecord(a.index, 'PASS')])))
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 10)
    assert.deepEqual(gate.counts, { PASS: 10, PASS_WITH_CORRECTIONS: 0, FAIL: 0 })
    assert.equal(gate.outcome, 'review_passed')
    assert.equal(gate.status, 'passed')
  })
})

test('a short batch of clean PASSes is partial_pass, never passed', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: verdictRecord(1, 'PASS') })
    const gate = evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.outcome, 'review_passed')
    assert.equal(gate.status, 'partial_pass')
  })
})

test('one PASS_WITH_CORRECTIONS blocks the pass', () => {
  withRunDir((runDir) => {
    const records = Object.fromEntries(attempts(10).map(a => [a.index, verdictRecord(a.index, 'PASS')]))
    records[4] = verdictRecord(4, 'PASS_WITH_CORRECTIONS')
    writeVerdicts(runDir, records)
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 10)
    assert.equal(gate.counts.PASS_WITH_CORRECTIONS, 1)
    assert.equal(gate.outcome, 'review_failed')
    assert.equal(gate.status, 'failed')
    assert.notEqual(gate.status, 'passed')
  })
})

test('one FAIL blocks the pass', () => {
  withRunDir((runDir) => {
    const records = Object.fromEntries(attempts(10).map(a => [a.index, verdictRecord(a.index, 'PASS')]))
    records[7] = verdictRecord(7, 'FAIL')
    writeVerdicts(runDir, records)
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.counts.FAIL, 1)
    assert.equal(gate.outcome, 'review_failed')
    assert.equal(gate.status, 'failed')
  })
})

test('a malformed verdict counts as not reviewed, never as PASS', () => {
  withRunDir((runDir) => {
    const records = Object.fromEntries(attempts(10).map(a => [a.index, verdictRecord(a.index, 'PASS')]))
    records[2] = 'this reviewer answered in prose and said the report was a PASS'
    writeVerdicts(runDir, records)
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 9)
    assert.equal(gate.counts.PASS, 9)
    assert.equal(gate.outcome, 'review_pending')
    assert.equal(gate.status, 'review_pending')
    assert.deepEqual(gate.unreviewed.map(entry => entry.attempt), [2])
    assert.match(gate.unreviewed[0].reason, /not valid JSON/)
  })
})

test('a verdict outside the vocabulary counts as not reviewed', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: { ...verdictRecord(1, 'PASS'), verdict: 'pass' } })
    const gate = evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 0)
    assert.equal(gate.status, 'review_pending')
    assert.match(gate.unreviewed[0].reason, /verdict must be exactly one of/)
  })
})

test('an attempt with no verdict at all keeps the run pending', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: verdictRecord(1, 'PASS') })
    const gate = evaluateReviewGate({ attempts: attempts(3), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 1)
    assert.equal(gate.status, 'review_pending')
    assert.deepEqual(gate.unreviewed.map(entry => entry.attempt), [2, 3])
    assert.equal(gate.unreviewed[0].reason, 'no stored review verdict')
  })
})

test('an error sidecar explains why an attempt is unreviewed', () => {
  withRunDir((runDir) => {
    mkdirSync(reviewsDir(runDir), { recursive: true })
    writeFileSync(join(reviewsDir(runDir), '01.error.json'), JSON.stringify({ attempt: 1, error: 'reviewer exited 1' }))
    const gate = evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.status, 'review_pending')
    assert.equal(gate.unreviewed[0].reason, 'reviewer exited 1')
  })
})

test('no reviews directory means nothing is reviewed', () => {
  withRunDir((runDir) => {
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 0)
    assert.equal(gate.status, 'review_pending')
  })
})

test('a mechanically failed attempt cannot be rescued by a PASS verdict', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: verdictRecord(1, 'PASS'), 2: verdictRecord(2, 'PASS') })
    const list = [{ index: 1, result: 'PASS', model: 'claude-sonnet-5' }, { index: 2, result: 'FAIL', model: 'claude-sonnet-5' }]
    const gate = evaluateReviewGate({ attempts: list, verdicts: loadVerdicts(runDir) })
    assert.equal(gate.outcome, 'mechanical_failed')
    assert.equal(gate.status, 'failed')
  })
})

test('a verdict filename that disagrees with its attempt field is rejected', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: verdictRecord(9, 'PASS') })
    const gate = evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.status, 'review_pending')
    assert.match(gate.unreviewed[0].reason, /names attempt 9/)
  })
})

// WARDEN 8: the filename alone must not establish which attempt a verdict is about.
test('one PASS copied across every filename reviews nothing', () => {
  withRunDir((runDir) => {
    const anonymous = { verdict: 'PASS', findings: [], summary: 'genuinely clean', reviewer: REVIEWER }
    writeVerdicts(runDir, Object.fromEntries(attempts(10).map(a => [a.index, anonymous])))
    const gate = evaluateReviewGate({ attempts: attempts(10), verdicts: loadVerdicts(runDir) })
    assert.equal(gate.reviewed, 0)
    assert.equal(gate.counts.PASS, 0)
    assert.equal(gate.status, 'review_pending')
    assert.equal(gate.unreviewed.length, 10)
    for (const entry of gate.unreviewed) assert.match(entry.reason, /no integer "attempt" field/)
  })
})

test('a verdict whose attempt field is not an integer is not a review', () => {
  for (const bad of ['1', 1.5, null, true, { value: 1 }]) {
    withRunDir((runDir) => {
      writeVerdicts(runDir, { 1: { ...verdictRecord(1, 'PASS'), attempt: bad } })
      const gate = evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) })
      assert.equal(gate.status, 'review_pending', `attempt ${JSON.stringify(bad)} should not count as reviewed`)
      assert.match(gate.unreviewed[0].reason, /no integer "attempt" field/)
    })
  }
})

// ------------------------------------------------------------ verdict schema --

test('a non-PASS verdict must carry findings', () => {
  assert.throws(() => validateVerdictPayload({ verdict: 'FAIL', findings: [], summary: 'bad' }), /at least one finding/)
})

// WARDEN 2: severity is an allowlist, not a blocklist.
test('a PASS is contradicted by any severity outside the cosmetic allowlist', () => {
  for (const severity of ['blocking', 'blocker', 'major', 'critical', 'high', 'severe', 'fatal', 'showstopper', 'P0', 'unknown-word', '']) {
    const findings = [{ claim: 'c', cited: 'a/b.ts:1', actual: 'x', severity }]
    assert.throws(
      () => validateVerdictPayload({ verdict: 'PASS', findings, summary: 's' }),
      severity === '' ? /severity must not be empty/ : /contradicts a .* finding/,
      `severity ${JSON.stringify(severity)} should not be compatible with PASS`,
    )
  }
})

test('a PASS tolerates only cosmetic severities, case-insensitively', () => {
  for (const severity of [...PASS_COMPATIBLE_SEVERITIES]) {
    for (const cased of [severity, severity.toUpperCase(), ` ${severity} `]) {
      const parsed = validateVerdictPayload({
        verdict: 'PASS',
        findings: [{ claim: 'c', cited: 'a/b.ts:1', actual: 'x', severity: cased }],
        summary: 's',
      })
      assert.equal(parsed.verdict, 'PASS')
    }
  }
})

test('findings must be fully populated', () => {
  assert.throws(() => validateVerdictPayload({ verdict: 'FAIL', findings: [{ claim: 'c' }], summary: 's' }), /findings\[0\]\.cited must be a string/)
  assert.throws(() => validateVerdictPayload({ verdict: 'FAIL', findings: [{ claim: 'c', cited: '' }], summary: 's' }), /findings\[0\]\.actual must be a string/)
  assert.throws(() => validateVerdictPayload({ verdict: 'FAIL', findings: [{ claim: 'c', cited: '', actual: 'x' }], summary: 's' }), /findings\[0\]\.severity must be a string/)
})

test('unknown keys are kept as schema notes rather than rejected', () => {
  const parsed = validateVerdictPayload({ verdict: 'PASS', findings: [], summary: 's', confidence: 0.9 })
  assert.equal(parsed.verdict, 'PASS')
  assert.equal(parsed.schemaNotes.length, 1)
  assert.match(parsed.schemaNotes[0], /confidence/)
})

test('a stored record needs reviewer provenance', () => {
  assert.throws(() => validateVerdictRecord({ verdict: 'PASS', findings: [], summary: 's' }), /reviewer must be a JSON object/)
  assert.throws(() => validateVerdictRecord({ verdict: 'PASS', findings: [], summary: 's', reviewer: { engine: 'copilot' } }), /reviewer\.model/)
})

// -------------------------------------------------------------- raw parsing --

test('a bare JSON object parses', () => {
  const parsed = parseVerdictText('{"verdict":"PASS","findings":[],"summary":"clean"}')
  assert.equal(parsed.ok, true)
  assert.equal(validateVerdictPayload(parsed.value).verdict, 'PASS')
})

test('a single fenced block parses', () => {
  const parsed = parseVerdictText('Here you go:\n```json\n{"verdict":"FAIL","findings":[{"claim":"c","cited":"a/b.ts:1","actual":"x","severity":"major"}],"summary":"s"}\n```\n')
  assert.equal(parsed.ok, true)
  assert.equal(validateVerdictPayload(parsed.value).verdict, 'FAIL')
})

test('prose alone never parses as a verdict', () => {
  const parsed = parseVerdictText('Overall this report is a PASS. Every citation checked out.')
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /not a single JSON object/)
})

test('two fenced blocks are ambiguous and refused', () => {
  const parsed = parseVerdictText('```json\n{"verdict":"PASS"}\n```\nand\n```json\n{"verdict":"FAIL"}\n```')
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /found 2 fenced/)
})

// ------------------------------------------------------ import protections ---

function importFixture(runDir, body) {
  const file = join(runDir, 'incoming.json')
  writeFileSync(file, JSON.stringify(body, null, 2))
  return file
}

// WARDEN 1: an import must not silently replace stored evidence.
test('an import refuses to overwrite an existing verdict without --force', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 3: verdictRecord(3, 'PASS') })
    const file = importFixture(runDir, { verdict: 'PASS', findings: [], summary: 'a second opinion' })
    assert.throws(
      () => importVerdict({ runId: 'r', runDir, attempts: attempts(3), file, attempt: 3 }),
      /already holds a PASS verdict.*--force/s,
    )
    assert.equal(loadVerdicts(runDir).get(3).record.summary, 'synthetic PASS')
  })
})

// WARDEN 1: the one route that stays closed no matter which flags are passed.
test('an import may never replace a stored non-PASS with a PASS, even with --force', () => {
  for (const stored of ['FAIL', 'PASS_WITH_CORRECTIONS']) {
    withRunDir((runDir) => {
      writeVerdicts(runDir, { 2: verdictRecord(2, stored) })
      const file = importFixture(runDir, { verdict: 'PASS', findings: [], summary: 'looks fine to me' })
      for (const force of [false, true]) {
        assert.throws(
          () => importVerdict({ runId: 'r', runDir, attempts: attempts(2), file, attempt: 2, force }),
          /may never replace a non-PASS verdict with a PASS/,
          `force=${force} must not open this route`,
        )
      }
      const gate = evaluateReviewGate({ attempts: attempts(2), verdicts: loadVerdicts(runDir) })
      assert.equal(gate.counts[stored], 1)
      assert.equal(gate.counts.PASS, 0)
    })
  }
})

test('--force supersedes a stored verdict by archiving it, never by deleting it', () => {
  withRunDir((runDir) => {
    writeVerdicts(runDir, { 1: verdictRecord(1, 'PASS') })
    const file = importFixture(runDir, {
      verdict: 'FAIL',
      findings: [{ claim: 'c', cited: 'a/b.ts:1', actual: 'the cited line disproves it', severity: 'blocking' }],
      summary: 'a human re-read this and disagrees',
    })
    const record = importVerdict({ runId: 'r', runDir, attempts: attempts(1), file, attempt: 1, force: true })
    assert.equal(record.verdict, 'FAIL')
    assert.equal(record.reviewer.engine, 'import')
    const files = readdirSync(reviewsDir(runDir))
    assert.ok(files.some(name => /^01\.superseded-.*\.json$/.test(name)), `expected an archived copy, saw ${files.join(', ')}`)
    const archived = files.find(name => /^01\.superseded-/.test(name))
    assert.equal(JSON.parse(readFileSync(join(reviewsDir(runDir), archived), 'utf8')).verdict, 'PASS')
    assert.equal(evaluateReviewGate({ attempts: attempts(1), verdicts: loadVerdicts(runDir) }).status, 'failed')
  })
})

// WARDEN 1: imported raw evidence must not clobber a dispatched reviewer's raw output.
test('imported raw text is stored separately from dispatched raw output', () => {
  withRunDir((runDir) => {
    mkdirSync(reviewsDir(runDir), { recursive: true })
    writeFileSync(join(reviewsDir(runDir), '01.raw.txt'), 'ORIGINAL DISPATCHED OUTPUT')
    const file = importFixture(runDir, { verdict: 'PASS', findings: [], summary: 'ok' })
    const record = importVerdict({ runId: 'r', runDir, attempts: attempts(1), file, attempt: 1 })
    assert.equal(record.raw, 'reviews/01.import.raw.txt')
    assert.equal(readFileSync(join(reviewsDir(runDir), '01.raw.txt'), 'utf8'), 'ORIGINAL DISPATCHED OUTPUT')
    assert.ok(existsSync(join(reviewsDir(runDir), '01.import.raw.txt')))
  })
})

// WARDEN 7: a verdict that names its subject is checked against it, not restamped.
test('an import that names a different run or attempt is refused', () => {
  withRunDir((runDir) => {
    const wrongRun = importFixture(runDir, { runId: 'some-other-run', verdict: 'PASS', findings: [], summary: 'ok' })
    assert.throws(
      () => importVerdict({ runId: 'the-real-run', runDir, attempts: attempts(2), file: wrongRun, attempt: 1 }),
      /names run "some-other-run" but the prepared run is the-real-run/,
    )
    const wrongAttempt = importFixture(runDir, { attempt: 2, verdict: 'PASS', findings: [], summary: 'ok' })
    assert.throws(
      () => importVerdict({ runId: 'r', runDir, attempts: attempts(2), file: wrongAttempt, attempt: 1 }),
      /names attempt 2 but attempt 1 was requested/,
    )
    for (const bad of ['1', 1.5, 0, null, true]) {
      const file = importFixture(runDir, { attempt: bad, verdict: 'PASS', findings: [], summary: 'ok' })
      assert.throws(
        () => importVerdict({ runId: 'r', runDir, attempts: attempts(2), file, attempt: 1 }),
        /"attempt" must be a positive integer/,
        `attempt ${JSON.stringify(bad)} should be rejected on type`,
      )
    }
    const badRun = importFixture(runDir, { runId: 42, verdict: 'PASS', findings: [], summary: 'ok' })
    assert.throws(
      () => importVerdict({ runId: 'r', runDir, attempts: attempts(2), file: badRun, attempt: 1 }),
      /"runId" must be a string/,
    )
    assert.equal(loadVerdicts(runDir).size, 0)
  })
})

test('an import with matching identity fields is accepted and stamped', () => {
  withRunDir((runDir) => {
    const file = importFixture(runDir, { runId: 'r', attempt: 2, verdict: 'PASS', findings: [], summary: 'ok' })
    const record = importVerdict({ runId: 'r', runDir, attempts: attempts(2), file, attempt: 2 })
    assert.equal(record.attempt, 2)
    assert.equal(record.runId, 'r')
    assert.equal(record.reviewer.engine, 'import')
    assert.equal(record.reviewer.missionModel, 'claude-sonnet-5')
  })
})

// ------------------------------------------------------- reviewer sandboxing --

// Real --usage-output-file shape from Copilot CLI 1.0.85 (probed 2026-09-16).
test('the reviewer model is read from currentModel / modelMetrics of the usage file', () => {
  const real = { totalPremiumRequestCost: 1, modelMetrics: { 'gpt-5.6-sol': { requests: { count: 1, cost: 1 } } }, currentModel: 'gpt-5.6-sol' }
  assert.equal(observedModelFromUsage(real), 'gpt-5.6-sol')
  assert.equal(observedModelFromUsage({ modelMetrics: { 'gpt-5.6-sol': {} } }), 'gpt-5.6-sol', 'modelMetrics alone still attributes')
  assert.equal(observedModelFromUsage({ currentModel: 'gpt-5.6-sol' }), 'gpt-5.6-sol')
  assert.equal(observedModelFromUsage({ model: 'gpt-5.6-sol' }), null, 'the pre-1609 guessed key is not the shape')
  assert.equal(observedModelFromUsage(null), null)
  assert.equal(observedModelFromUsage({}), null)
  const mixed = observedModelFromUsage({ currentModel: 'gpt-5.6-sol', modelMetrics: { 'gpt-5.6-sol': {}, 'claude-sonnet-5': {} } })
  assert.equal(mixed, 'claude-sonnet-5+gpt-5.6-sol', 'two serving models cannot be attributed to one reviewer')
  assert.ok(modelProvenanceError({ observedModel: mixed, configuredModel: 'gpt-5.6-sol', missionModel: 'claude-sonnet-5' }), 'a mixed session fails provenance')
})

// 1609 live finding: the first real reviewer marked three correct assertions
// unverifiable because the report cited them as shorthand continuations
// ("file.ts:173, :187, :234, and :245") that the bundle never resolved.
test('shorthand line continuations after a citation resolve against the same file', () => {
  const text = 'see `a/b/test.ts:173, :187, :234, and :245` and a/b/src.ts:213 and :219; also a/b/x.ts:10-12, :30-31 then c/d.ts:5.'
  const { total, distinct } = extractCitations(text)
  assert.deepEqual(distinct.map(c => c.display), [
    'a/b/test.ts:173', 'a/b/test.ts:187', 'a/b/test.ts:234', 'a/b/test.ts:245',
    'a/b/src.ts:213', 'a/b/src.ts:219',
    'a/b/x.ts:10-12', 'a/b/x.ts:30-31',
    'c/d.ts:5',
  ])
  assert.equal(total, 9)
  assert.ok(distinct.every(c => Number.isInteger(c.startLine) && c.endLine >= c.startLine))
  // A bare ":12" with no preceding citation is not a citation of anything.
  assert.equal(extractCitations('ratio :12 and :13').total, 0)
  // A continuation never crosses into a different full citation.
  assert.deepEqual(extractCitations('a/b.ts:1, c/d.ts:2').distinct.map(c => c.display), ['a/b.ts:1', 'c/d.ts:2'])
  // Warden 1609 finding 3: a clause that goes on to name another file makes
  // the shorthand ambiguous, so it is dropped rather than misattributed.
  assert.deepEqual(extractCitations('counts in a/b.ts:10 and :20 of c/d.ts differ').distinct.map(c => c.display), ['a/b.ts:10'])
  assert.deepEqual(extractCitations('see a/b.ts:10, :20 (compare c/d.ts).').distinct.map(c => c.display), ['a/b.ts:10', 'a/b.ts:20'], 'a path after the clause boundary does not cancel the continuation')
  assert.deepEqual(extractCitations('`a/b.ts:65 and :68`) and `a/b.ts:213 and :219`').distinct.map(c => c.display), ['a/b.ts:65', 'a/b.ts:68', 'a/b.ts:213', 'a/b.ts:219'], 'the live report forms still resolve')
})

// WARDEN 1609: a reviewer that never received the bundle can still exit 0 with
// schema-valid JSON. It must echo the report marker, whose value is never in
// the instruction, and an empty prompt is refused before any spawn.
test('a verdict that does not echo the bundle marker is not a review', () => {
  const marker = 'AEON_OS_E2E_2026-09-16T15-10-24-504Z-24c870_01'
  assert.equal(markerEchoError({ verdict: 'FAIL', marker }, marker), null)
  assert.equal(markerEchoError({ verdict: 'FAIL', marker: ` ${marker}\n` }, marker), null, 'surrounding whitespace is tolerated')
  assert.match(markerEchoError({ verdict: 'FAIL' }, marker), /did not echo/)
  assert.match(markerEchoError({ verdict: 'PASS', marker: '' }, marker), /did not echo/)
  assert.match(markerEchoError({ verdict: 'PASS', marker: 'AEON_OS_E2E_other_01' }, marker), /not attributable to this bundle/)
  assert.equal(markerEchoError({ verdict: 'PASS' }, null), null, 'attempts without a marker (imports, legacy) are not gated on it')
  const prompt = buildReviewPrompt({ runId: 'r', attempt: 1, bundleText: `${marker}\nbody`, revision: 'abc' })
  const instruction = prompt.slice(0, prompt.indexOf('===== REVIEW BUNDLE'))
  assert.ok(!instruction.includes(marker), 'the instruction must never contain the marker value')
  assert.match(instruction, /begins with AEON_OS_E2E_/)
  assert.doesNotThrow(() => validateVerdictPayload({ verdict: 'PASS', findings: [], summary: 's', marker }))
  assert.deepEqual(validateVerdictPayload({ verdict: 'PASS', findings: [], summary: 's', marker }).schemaNotes, [], 'marker is a known key, not a schema note')
})

// The one thing that broke live: the prompt must arrive on stdin, whole. A
// fake reviewer (node -e) reads its stdin and reports the byte count and the
// last line, so delivery is locked without touching the real CLI.
test('the whole prompt reaches the reviewer on stdin, argv carries no prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-review-stdin-'))
  try {
    const script = join(dir, 'fake.js')
    writeFileSync(script, "let n=0,last='';process.stdin.on('data',c=>{n+=c.length;last=c.toString().split('\\n').filter(Boolean).at(-1)});process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({bytes:n,last,argvHasPrompt:process.argv.includes('-p')}))})")
    // Node refuses to spawn a .cmd shim without a shell, so the fake reviewer is
    // node itself; the production argument builder is asserted separately.
    const stdinText = `${'y'.repeat(40_000)}\nLAST-LINE-MARKER\n`
    const out = await dispatchCopilotReview({ binary: process.execPath, model: 'm', stdinText, cwd: dir, maxAiCredits: 30, timeoutMs: 20_000, usageFile: join(dir, 'usage.json'), buildArgs: () => [script] })
    assert.equal(out.spawnError, null)
    assert.equal(out.status, 0)
    const echoed = JSON.parse(out.stdout)
    assert.equal(echoed.bytes, Buffer.byteLength(stdinText), 'every byte of the prompt must reach the reviewer')
    assert.equal(echoed.last, 'LAST-LINE-MARKER', 'the tail of the prompt must arrive intact')
    assert.equal(echoed.argvHasPrompt, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty reviewer prompt is refused before anything is spawned', async () => {
  for (const stdinText of ['', '   ', undefined, null, 42]) {
    const out = await dispatchCopilotReview({ binary: process.execPath, model: 'm', stdinText, cwd: tmpdir(), maxAiCredits: 30, timeoutMs: 1000, usageFile: join(tmpdir(), 'never-written.json') })
    assert.match(out.spawnError, /prompt is empty/)
    assert.equal(out.status, null)
    assert.equal(out.observedModel, null)
  }
})

// WARDEN 3: the reviewer gets no shell, no writes, no network, no temp grant.
test('the reviewer command line denies the tools that could reach the repository', () => {
  const args = reviewerArgs({ model: 'gpt-5.6-sol', maxAiCredits: 30, usageFile: 'u.json' })
  assert.ok(args.includes('--deny-tool=shell'), 'shell must be denied: path verification does not constrain it')
  assert.ok(args.includes('--deny-tool=write'))
  assert.ok(args.includes('--deny-tool=url'))
  assert.ok(args.includes('--disallow-temp-dir'))
  assert.ok(args.some(arg => arg.startsWith('--secret-env-vars=')))
  assert.ok(args.some(arg => arg.startsWith('--secret-env-vars=') && arg.includes('KAIROS_AEON_API_KEY') && arg.includes('DATABASE_URL')))
  assert.ok(!args.includes('--allow-all-paths'), 'file access must stay scoped to the throwaway cwd')
  assert.ok(!args.includes('--allow-all'))
  assert.ok(!args.includes('--yolo'))
  assert.ok(!args.includes('--allow-all-urls'))
  // Ordered so that a build which replaces rather than appends repeated
  // --deny-tool values still ends up denying the dangerous one.
  const deny = args.filter(arg => arg.startsWith('--deny-tool='))
  assert.equal(deny.at(-1), '--deny-tool=shell')
})

// WARDEN 11: the model that answered must be the model that was asked.
test('a reviewer that reports a different model than requested is not a review', () => {
  const error = modelProvenanceError({ observedModel: 'claude-sonnet-5', configuredModel: 'gpt-5.6-sol', missionModel: 'claude-sonnet-5' })
  assert.match(error, /reported model claude-sonnet-5 but gpt-5\.6-sol was requested/)
  const substituted = modelProvenanceError({ observedModel: 'gpt-5.4-mini', configuredModel: 'gpt-5.6-sol', missionModel: 'claude-sonnet-5' })
  assert.match(substituted, /not attributable to the configured reviewer/)
})

test('a reviewer observed running the mission model is not independent', () => {
  const error = modelProvenanceError({ observedModel: 'claude-sonnet-5', configuredModel: 'claude-sonnet-5', missionModel: 'claude-sonnet-5' })
  assert.match(error, /the same model that wrote the report/)
  // --allow-same-model is the one way that becomes admissible, and it is
  // recorded in the verdict when it is used.
  assert.equal(modelProvenanceError({ observedModel: 'claude-sonnet-5', configuredModel: 'claude-sonnet-5', missionModel: 'claude-sonnet-5', allowSameModel: true }), null)
})

test('sound or absent provenance does not block a verdict', () => {
  assert.equal(modelProvenanceError({ observedModel: 'gpt-5.6-sol', configuredModel: 'gpt-5.6-sol', missionModel: 'claude-sonnet-5' }), null)
  // The platform does not always report an identity; an absent one is an
  // assurance gap already recorded elsewhere, not grounds to discard a verdict.
  for (const absent of [null, undefined, '']) {
    assert.equal(modelProvenanceError({ observedModel: absent, configuredModel: 'gpt-5.6-sol', missionModel: 'claude-sonnet-5' }), null)
  }
})

// WARDEN 4: a timed-out reviewer must not leave a subprocess pinning the scratch.
test('killTree reaps a whole process tree', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' })
  await new Promise((done) => child.once('spawn', done))
  const exited = new Promise((done) => child.once('exit', done))
  killTree(child.pid)
  await exited
  assert.notEqual(child.exitCode ?? child.signalCode, null)
  assert.doesNotThrow(() => killTree(undefined))
  assert.doesNotThrow(() => killTree(0))
})

// WARDEN 3: an oversized bundle is refused rather than reviewed with a file tool.
// The whole prompt is piped to stdin (1609: a real 31,754-character bundle blew
// the old 24,000-character argv ceiling before any reviewer ran), so the only
// remaining limit is the reviewer's context, and above it the run stays unreviewed.
test('the whole prompt travels on stdin and an oversized bundle is refused', () => {
  const small = buildReviewPrompt({ runId: 'r', attempt: 1, bundleText: 'BUNDLE BODY', revision: 'abc1234' })
  assert.ok(bundleFits(small))
  assert.match(small, /BUNDLE BODY/)
  assert.match(small, /===== REVIEW BUNDLE — run r, attempt 01 =====/)
  assert.match(small, /===== END OF REVIEW BUNDLE =====/)
  const real = buildReviewPrompt({ runId: 'r', attempt: 1, bundleText: 'x'.repeat(31_754) })
  assert.ok(bundleFits(real), 'the 1609 pilot bundle size must be deliverable')
  const huge = buildReviewPrompt({ runId: 'r', attempt: 1, bundleText: 'x'.repeat(MAX_BUNDLE_CHARS) })
  assert.ok(!bundleFits(huge))
  assert.ok(bundleFits('x'.repeat(MAX_BUNDLE_CHARS)), 'exactly the ceiling is deliverable')
  assert.ok(!bundleFits('x'.repeat(MAX_BUNDLE_CHARS + 1)), 'one over the ceiling is refused')
  // The prompt builder has no file mode at all, so no reviewer can be given a
  // reason to read from disk.
  assert.ok(!small.includes('current working directory'))
})

// 1609 live finding: Copilot ignores piped input whenever -p is present, so the
// first real reviewer run judged an empty message and returned a FAIL that said
// so. The prompt must reach the CLI on stdin alone.
test('the reviewer command line never carries -p, because piped input is ignored alongside it', () => {
  const args = reviewerArgs({ model: 'gpt-5.6-sol', maxAiCredits: 30, usageFile: 'u.json' })
  assert.ok(!args.includes('-p'))
  assert.ok(!args.includes('--prompt'))
  assert.ok(!args.includes('-i'))
  assert.ok(!args.includes('--interactive'))
  assert.deepEqual(args.slice(0, 2), ['--model', 'gpt-5.6-sol'])
})

test('the reviewer prompt states the rules that the mechanical gate cannot check', () => {
  const prompt = buildReviewPrompt({ runId: 'r', attempt: 3, bundleText: 'BUNDLE BODY', revision: 'abc1234' })
  assert.match(prompt, /INDEPENDENT reviewer/)
  assert.match(prompt, /Pinned revision under review: abc1234/)
  assert.match(prompt, /contradicts is a FAIL/)
  assert.match(prompt, /Citation drift is at least PASS_WITH_CORRECTIONS/)
  assert.match(prompt, /SINGLE JSON object and nothing else/)
})

// ------------------------------------------------------- reviewer independence --

test('a reviewer model identical to the mission model is refused before any dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-review-same-'))
  try {
    await assert.rejects(
      () => runReview({
        runId: 'sandbox',
        runDir: dir,
        attempts: attempts(2, 'claude-sonnet-5'),
        config: { engine: 'copilot', model: 'claude-sonnet-5', maxAiCredits: 30, timeoutMs: 900_000 },
        log: () => {},
      }),
      /an independent review needs a different model/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the shipped bootstrap reviewer differs from the mission model', () => {
  const cfg = reviewConfig({ review: { engine: 'copilot', model: 'gpt-5.6-sol', maxAiCredits: 30, timeoutMs: 900000 } })
  assert.equal(cfg.engine, 'copilot')
  assert.notEqual(cfg.model, 'claude-sonnet-5')
})

test('an unusable reviewer configuration is refused up front', () => {
  assert.throws(() => reviewConfig({ review: { engine: 'claude' } }), /not supported/)
  assert.throws(() => reviewConfig({ review: { model: '--dangerous' } }), /review\.model/)
  assert.throws(() => reviewConfig({ review: { maxAiCredits: 0 } }), /maxAiCredits/)
  assert.throws(() => reviewConfig({ review: { timeoutMs: 5 } }), /timeoutMs/)
})

// WARDEN 6: the gate's own end states must be archivable.
test('prepare --new accepts every end state the gate can produce', () => {
  assert.deepEqual(ARCHIVABLE_STATUSES, ['failed', 'passed', 'partial_pass', 'review_pending'])
  for (const status of ['failed', 'passed', 'partial_pass', 'review_pending']) {
    assert.equal(archiveDecision(status).allowed, true, `${status} must be archivable`)
  }
  for (const status of ['preparing', 'prepared', 'running']) {
    assert.equal(archiveDecision(status).allowed, false, `${status} must not be archivable`)
  }
  assert.equal(archiveDecision('review_pending').abandoned, true)
  assert.equal(archiveDecision('passed').abandoned, false)
  assert.equal(archiveDecision('failed').abandoned, false)
})

// --------------------------------------------------------- CLI sandbox cases --
//
// These copy the harness into a temp directory with a synthetic state.json, so
// run.mjs resolves its own results/ and .runtime/ inside the sandbox and the
// real evidence is never opened. AEON_* is pointed at a discard port; every
// assertion below is reached before any network call.

const SANDBOX_FILES = ['run.mjs', 'review.mjs', 'review-bundle.mjs', 'probe-copilot-models.mjs', 'bootstrap.json']
const SANDBOX_ENV = {
  AEON_BASE_URL: 'https://127.0.0.1:9',
  KAIROS_AEON_API_KEY: 'sandbox-not-a-real-key',
  KAIROS_COPILOT_DEFAULT_MODEL: 'claude-sonnet-5',
}

function sandbox(status, attemptCount) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-os-cli-'))
  const home = join(root, 'workflows')
  mkdirSync(home, { recursive: true })
  for (const file of SANDBOX_FILES) cpSync(join(HERE, file), join(home, file))
  const runId = '2026-09-12T00-00-00-000Z-sandbx'
  const state = {
    version: 1,
    runId,
    createdAt: '2026-09-12T00:00:00.000Z',
    sourceBranch: 'sandbox',
    baseSha: '0'.repeat(40),
    originPath: join(home, '.runtime', 'runs', runId, 'origin.git'),
    clonePath: join(home, '.runtime', 'runs', runId, 'source'),
    registryPath: join(home, '.runtime', 'runs', runId, 'repos.json'),
    projectId: 'sandbox',
    columns: {},
    // No sessionId: `status` only reaches for a remote session when the last
    // attempt records one, and these cases assert local gate state only.
    attempts: attempts(attemptCount).map(a => ({ ...a, taskId: `t-${a.index}`, sessionId: null, branch: `aeon/${a.index}`, commit: 'f'.repeat(40) })),
    worker: null,
    status,
    mechanical: attemptCount === 10 ? 'passed' : 'partial_pass',
  }
  mkdirSync(join(home, '.runtime', 'runs', runId), { recursive: true })
  writeFileSync(join(home, '.runtime', 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  mkdirSync(join(home, 'results', runId), { recursive: true })
  return { root, home, runId }
}

function cli(home, args) {
  const out = spawnSync(process.execPath, [join(home, 'run.mjs'), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    env: { ...process.env, ...SANDBOX_ENV },
  })
  return { code: out.status, text: `${out.stdout ?? ''}${out.stderr ?? ''}` }
}

// WARDEN 5: a terminal run is a receipt, not a workspace.
test('run refuses to reopen a terminal run', () => {
  for (const status of ['passed', 'partial_pass']) {
    const { root, home } = sandbox(status, 10)
    try {
      const res = cli(home, ['run', '--count=10'])
      assert.equal(res.code, 1)
      assert.match(res.text, new RegExp(`is ${status}; a terminal run is immutable`))
      // run.json must not have been rewritten by the refused call.
      assert.equal(existsSync(join(home, 'results', '2026-09-12T00-00-00-000Z-sandbx', 'run.json')), false)
      assert.equal(JSON.parse(readFileSync(join(home, '.runtime', 'state.json'), 'utf8')).status, status)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('run refuses a count that would create no new attempt', () => {
  const { root, home } = sandbox('review_pending', 10)
  try {
    const res = cli(home, ['run', '--count=10'])
    assert.equal(res.code, 1)
    assert.match(res.text, /would create no new attempt/)
    assert.equal(existsSync(join(home, 'results', '2026-09-12T00-00-00-000Z-sandbx', 'models.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// WARDEN 6: abandoning a review_pending run stamps its receipt.
test('prepare --new archives a review_pending run and marks the receipt abandoned', () => {
  const { root, home, runId } = sandbox('review_pending', 3)
  try {
    // The archive is written before prepare reaches the network, so the later
    // connection failure does not affect what this asserts.
    cli(home, ['prepare', '--new'])
    const dir = join(home, 'results', runId)
    const archived = JSON.parse(readFileSync(join(dir, 'archived-state.json'), 'utf8'))
    assert.equal(archived.abandoned, true)
    assert.equal(archived.status, 'review_pending')
    const receipt = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
    assert.equal(receipt.abandoned, true)
    assert.equal(receipt.status, 'review_pending')
    assert.equal(receipt.review.reviewed, 0)
    assert.equal(receipt.review.total, 3)
    assert.match(receipt.note, /never fully reviewed and is not a pass/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prepare --new refuses a run that is still in flight', () => {
  const { root, home } = sandbox('prepared', 2)
  try {
    const res = cli(home, ['prepare', '--new'])
    assert.equal(res.code, 1)
    assert.match(res.text, /only a failed, completed, partially passed or review-pending run can be archived/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// WARDEN 9: a run left pending must not report success.
test('review exits non-zero unless the whole batch reviewed clean', () => {
  const { root, home, runId } = sandbox('review_pending', 2)
  try {
    const file = join(home, 'verdict.json')
    writeFileSync(file, JSON.stringify({ attempt: 1, verdict: 'PASS', findings: [], summary: 'clean' }))
    const pending = cli(home, ['review', '--import', file, '--attempt=1'])
    assert.equal(pending.code, 1, 'one of two attempts reviewed is not a success')
    assert.match(pending.text, /"outcome": "review_pending"/)

    const second = join(home, 'verdict-2.json')
    writeFileSync(second, JSON.stringify({ attempt: 2, verdict: 'PASS', findings: [], summary: 'clean' }))
    const complete = cli(home, ['review', '--import', second, '--attempt=2'])
    assert.equal(complete.code, 0, 'a complete clean review is the only success')
    assert.match(complete.text, /"outcome": "review_passed"/)
    assert.equal(JSON.parse(readFileSync(join(home, 'results', runId, 'run.json'), 'utf8')).status, 'partial_pass')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('review exits non-zero when the completed review failed', () => {
  const { root, home } = sandbox('review_pending', 1)
  try {
    const file = join(home, 'verdict.json')
    writeFileSync(file, JSON.stringify({
      attempt: 1,
      verdict: 'FAIL',
      findings: [{ claim: 'c', cited: 'a/b.ts:1', actual: 'the cited line disproves it', severity: 'blocking' }],
      summary: 'not trustworthy',
    }))
    const res = cli(home, ['review', '--import', file, '--attempt=1'])
    assert.equal(res.code, 1)
    assert.match(res.text, /"outcome": "review_failed"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// WARDEN 10: only a run that finished before the gate existed is legacy.
test('status calls a run legacy only when it is terminal with attempts and no reviews', () => {
  for (const [status, expected] of [['passed', true], ['failed', true], ['partial_pass', true], ['prepared', false], ['review_pending', false]]) {
    const { root, home } = sandbox(status, 2)
    try {
      const res = cli(home, ['status'])
      const json = JSON.parse(res.text.slice(res.text.indexOf('{')))
      assert.equal(json.review.legacy, expected, `${status} legacy should be ${expected}`)
      if (!expected) assert.match(json.review.progress, /0\/2 reviewed/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a terminal run with no attempts recorded is not legacy', () => {
  const { root, home } = sandbox('failed', 0)
  try {
    const res = cli(home, ['status'])
    const json = JSON.parse(res.text.slice(res.text.indexOf('{')))
    assert.equal(json.review.legacy, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--force is refused on a dispatched review', () => {
  const { root, home } = sandbox('review_pending', 2)
  try {
    const res = cli(home, ['review', '--force'])
    assert.equal(res.code, 1)
    assert.match(res.text, /--force only applies to --import/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
