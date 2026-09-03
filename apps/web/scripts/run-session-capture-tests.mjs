import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
const supportsUnflaggedSqlite = major > 22 || (major === 22 && minor >= 13)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const tests = [
  join(scriptDir, 'session-transcript.test.mjs'),
  join(scriptDir, 'session-title.test.mjs'),
  join(scriptDir, 'codex-session-transcript.test.mjs'),
  join(scriptDir, 'session-capture-dispatch.test.mjs'),
  join(scriptDir, 'session-capture-queue.test.mjs'),
  join(scriptDir, 'verify-schema-drift.test.mjs'),
]
if (supportsUnflaggedSqlite) tests.push(join(scriptDir, 'copilot-session-transcript.test.mjs'))
else console.warn('Skipping Copilot SQLite tests: Node 22.13+ is required')

const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' })
process.exit(result.status ?? 1)
