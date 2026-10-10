#!/usr/bin/env node
// Aeon living world — freshness check. Reports where Aeon is falling behind:
// model registry, stale help text, architecture docs, version/changelog drift,
// and dependency drift (REPORT ONLY — this script never installs or upgrades).
//
//   npm run freshness                         full report to stdout
//   npm run freshness -- --skip-deps          skip `npm outdated` (fast, offline)
//   npm run freshness -- --out report.md      also write the report to a file
//   npm run freshness -- --strict             exit 1 when any 🔴 finding exists
//
// Rules live in scripts/freshness/lib.mjs (pure, unit-tested); this file only does IO.
// What to do per finding: docs/aeon-living-world.md.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkArchitectureLag,
  checkDependencies,
  checkModels,
  checkRetiredTerms,
  checkVersions,
  constVersion,
  currentModelIds,
  extractModelLiterals,
  finding,
  matchesAny,
  newestHistoryDate,
  renderReport,
  scanRetiredTerms,
  summariseOutdated,
  topChangelogVersion,
  unmentionedFolders,
} from './freshness/lib.mjs'
import { findPrivateTerms } from '../apps/web/scripts/changelog-sync.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.turbo', 'dist', 'build', 'out', 'coverage', '.runtime'])
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx)$/i

function parseArgs(argv) {
  const args = { strict: false, skipDeps: false, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--strict') args.strict = true
    else if (a === '--skip-deps') args.skipDeps = true
    else if (a === '--out') args.out = argv[++i]
    else if (a.startsWith('--out=')) args.out = a.slice(6)
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/aeon-freshness.mjs [--skip-deps] [--strict] [--out <file>]')
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return args
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null)

/** Recursively list files (repo-relative, posix) under `dir`, skipping build/vendor dirs. */
function walk(dir, out = []) {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out)
    } else if (e.isFile() && TEXT_EXT.test(e.name)) {
      out.push(rel(join(abs, e.name)))
    }
  }
  return out
}

function listDirs(dir) {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('__'))
    .map((e) => e.name)
}

// ---------------------------------------------------------------- sections

function loadRegistry() {
  const raw = read('packages/shared/src/ai/model-registry.json')
  if (!raw) return { registry: null }
  try {
    return { registry: JSON.parse(raw) }
  } catch (e) {
    return { registry: null, error: e.message }
  }
}

function modelsSection(now, { registry, error }) {
  if (error) return { title: 'Models', findings: [finding('red', `model-registry.json is not valid JSON: ${error}`)] }
  const excluded = ['aeon_os/workflows/results/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*']
  const files = ['apps/web/src', 'apps/kairos-worker/src', 'aeon_os/workflows']
    .flatMap((d) => walk(d))
    .filter((f) => !f.endsWith('.md') && !matchesAny(f, excluded))
  const hits = files.flatMap((file) => extractModelLiterals(read(file)).map((h) => ({ file, ...h })))
  return { title: 'Models', findings: checkModels(registry, now, hits) }
}

function guidesSection({ registry }) {
  const config = JSON.parse(read('scripts/freshness/retired-terms.json'))
  const candidates = [
    ...walk('apps/web/src/components'),
    ...walk('apps/web/src/app/settings'),
    ...walk('apps/web/docs'),
    ...walk('docs/kairos'),
    ...walk('architecture'),
    ...readdirSync(ROOT).filter((f) => /\.md$/i.test(f)),
  ]
  const files = candidates
    .filter((p) => matchesAny(p, config.scan) && !matchesAny(p, config.allow))
    .map((path) => ({ path, text: read(path) }))
  const hits = scanRetiredTerms(files, config, { currentModelIds: currentModelIds(registry) })
  return { title: 'Help guides & docs', findings: checkRetiredTerms(hits) }
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function architectureSection() {
  const history = read('architecture/history.md') ?? ''
  const commitDate = git(['log', '-1', '--format=%cs', '-E', '--grep=^(feat|fix)\\(', '--', 'apps/']) || null
  const findings = checkArchitectureLag(newestHistoryDate(history), commitDate)

  const docText = walk('architecture')
    .filter((f) => f.endsWith('.md'))
    .map((f) => read(f))
    .join('\n')
  const folders = [
    ...listDirs('apps/web/src/lib').map((name) => ({ prefix: 'lib', name })),
    ...listDirs('apps/web/src/app/api').map((name) => ({ prefix: 'api', name })),
  ]
  const missing = unmentionedFolders(folders, docText)
  findings.push(
    missing.length
      ? finding(
          'yellow',
          `${missing.length} top-level folder(s) never mentioned in architecture/*.md.`,
          missing.map((m) => `${m.prefix === 'lib' ? 'apps/web/src/lib' : 'apps/web/src/app/api'}/${m.name}`),
        )
      : finding('green', `All ${folders.length} top-level lib/ and app/api/ folders are mentioned in architecture/*.md.`),
  )
  return { title: 'Architecture docs', findings }
}

function versionsSection() {
  const appVersion = constVersion(read('apps/web/src/lib/version.ts') ?? '', 'APP_VERSION')
  const kairosVersion = constVersion(read('apps/web/src/lib/kairos/version.ts') ?? '', 'KAIROS_VERSION')
  const privateModule = read('apps/web/src/lib/changelog-private.ts') ?? ''
  // Public log (testers) vs the owner-only Vorath log; apps/web/scripts/changelog-sync.mjs owns both rules.
  const leaks = ['CHANGELOG.md', 'apps/web/src/lib/changelog.ts'].flatMap((p) =>
    findPrivateTerms(read(p) ?? '').map((h) => `${p}:${h.line} "${h.term}"`),
  )
  return {
    title: 'Versions & changelogs',
    findings: [
      ...checkVersions([
        {
          label: 'App version (public changelog)',
          values: {
            'lib/version.ts': appVersion,
            'CHANGELOG.md': topChangelogVersion(read('CHANGELOG.md') ?? ''),
            'lib/changelog.ts': topChangelogVersion(read('apps/web/src/lib/changelog.ts') ?? ''),
          },
        },
        {
          label: 'Vorath version (private changelog)',
          values: {
            'lib/kairos/version.ts': kairosVersion,
            'docs/kairos/CHANGELOG.md': topChangelogVersion(read('docs/kairos/CHANGELOG.md') ?? ''),
            'lib/changelog-private.ts': constVersion(privateModule, 'PRIVATE_CHANGELOG_VERSION'),
          },
        },
      ]),
      leaks.length
        ? finding('red', `Public changelog mentions Vorath content (${leaks.length} line(s)); move it to docs/kairos/CHANGELOG.md.`, leaks)
        : finding('green', 'Public changelog has no Vorath content.'),
    ],
  }
}

function depsSection(skip) {
  const title = 'Dependencies'
  const note = 'Report only — upgrades need the owner’s go. This check never installs anything.'
  if (skip) return { title, note, findings: [finding('green', 'Skipped (--skip-deps).')] }
  // `npm outdated` exits 1 whenever something is outdated; only stdout matters.
  const r = spawnSync('npm', ['outdated', '--json', '--workspaces'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  })
  let json
  try {
    json = JSON.parse(r.stdout?.trim() || '{}')
  } catch {
    return { title, note, findings: [finding('yellow', `Could not parse \`npm outdated\` output (exit ${r.status}).`, [String(r.stderr ?? '').slice(0, 300)])] }
  }
  if (json && json.error) {
    return { title, note, findings: [finding('yellow', `\`npm outdated\` failed: ${json.error.summary ?? json.error.code}`)] }
  }
  return { title, note, findings: checkDependencies(summariseOutdated(json)) }
}

function routinesSection() {
  const test = 'apps/web/src/lib/kairos/thinking/__tests__/planned-kinds.test.ts'
  return {
    title: 'Routines & brain',
    findings: [
      existsSync(join(ROOT, test))
        ? finding('green', `BRAIN_JOBS ↔ PLANNED_THINKING_KINDS covered by test (${test}).`)
        : finding('yellow', `The BRAIN_JOBS ↔ PLANNED_THINKING_KINDS lock test is missing (${test}).`),
    ],
  }
}

// ---------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2))
const now = new Date()
const reg = loadRegistry()
const sections = [modelsSection(now, reg), guidesSection(reg), architectureSection(), versionsSection(), depsSection(args.skipDeps), routinesSection()]
const { markdown, summary, counts } = renderReport(sections, { generatedAt: now.toISOString() })

process.stdout.write(markdown)
if (args.out) writeFileSync(resolve(process.cwd(), args.out), markdown, 'utf8')
// In GitHub Actions, expose the counts to later steps (freshness.yml opens/closes the issue).
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `green=${counts.green}\nyellow=${counts.yellow}\nred=${counts.red}\n`)
}
console.error(`freshness: ${summary}`)
process.exit(args.strict && counts.red > 0 ? 1 : 0)
