import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const repo = resolve(directory, '../..')
const tests = [
  'src/components/board/__tests__/MissionEditorModal.test.tsx',
  'src/components/board/__tests__/useBoardHandlers-launch.test.tsx',
  'src/lib/actions/__tests__/hangar-launch.test.ts',
  'src/components/board/__tests__/autoRun.test.ts',
  'src/components/board/__tests__/useBoardDnD-autoRun.test.tsx',
]

if (!process.argv.includes('--run')) {
  console.log('Usage: node aeon_os/workflows/verify-ui.mjs --run\nRuns the focused UI/action contracts ten times. No live jobs or browser clicks.')
  process.exit(0)
}
for (const path of tests) {
  if (!existsSync(resolve(repo, 'apps/web', path))) throw new Error(`Missing test: ${path}`)
}

const runId = `ui-${new Date().toISOString().replace(/[:.]/g, '-')}`
const output = resolve(directory, 'results', runId)
const raw = resolve(directory, '.runtime', runId)
mkdirSync(output, { recursive: true })
mkdirSync(raw, { recursive: true })
const evidence = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'Local component, handler and server-action contracts; external boundaries mocked. Not authenticated browser E2E.',
  tests,
  testHashes: Object.fromEntries(tests.map(path => [path, createHash('sha256').update(readFileSync(resolve(repo, 'apps/web', path))).digest('hex')])),
  rounds: [],
  status: 'RUNNING',
}
const save = () => writeFileSync(resolve(output, 'summary.json'), `${JSON.stringify(evidence, null, 2)}\n`)
save()

for (let round = 1; round <= 10; round++) {
  const report = resolve(raw, `${round}.json`)
  const startedAt = new Date().toISOString()
  console.log(`UI contract verification ${round}/10`)
  const result = await new Promise((done) => {
    let tail = ''
    const child = spawn(process.execPath, [
      resolve(repo, 'node_modules/vitest/vitest.mjs'), 'run', ...tests,
      '--maxWorkers=1', '--minWorkers=1', '--reporter=json', `--outputFile=${report}`,
    ], { cwd: resolve(repo, 'apps/web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { tail = (tail + data).slice(-8000) })
    child.on('error', error => done({ exitCode: null, error: error.message }))
    child.on('close', exitCode => done({ exitCode, tail }))
  })
  const data = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null
  const passed = result.exitCode === 0 && data?.success === true && data.numPassedTests > 0
  evidence.rounds.push({
    round, startedAt, endedAt: new Date().toISOString(), exitCode: result.exitCode,
    status: passed ? 'PASS' : 'FAIL', testsPassed: data?.numPassedTests ?? 0,
    testsFailed: data?.numFailedTests ?? null,
    ...(passed ? {} : { error: result.error ?? result.tail }),
  })
  if (!passed) {
    evidence.status = 'FAIL'
    save()
    console.error(`Round ${round} failed. Evidence: ${resolve(output, 'summary.json')}`)
    process.exitCode = 1
    break
  }
  save()
}
if (evidence.rounds.length === 10 && evidence.rounds.every(round => round.status === 'PASS')) evidence.status = 'PASS'
evidence.endedAt = new Date().toISOString()
save()
console.log(`${evidence.status}: ${evidence.rounds.filter(round => round.status === 'PASS').length}/10 rounds; ${resolve(output, 'summary.json')}`)
