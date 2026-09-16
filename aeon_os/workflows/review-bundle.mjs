#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results')
const RUNTIME_RUNS = join(HERE, '.runtime', 'runs')
const USAGE = `Usage:
  node aeon_os/workflows/review-bundle.mjs --run=<runId> [--attempt=N] [--json]
  node aeon_os/workflows/review-bundle.mjs --report=<path-to-report.md> --source=<path-to-repo-checkout> [--json]`
const CITATION_PATTERN = /(?<![A-Za-z0-9_.@\[\]{}+\\/-])`?((?:[A-Za-z]:[\\/]|[\\/]{1,2})?[A-Za-z0-9_.@\[\]{}+-][A-Za-z0-9_.@()[\]{}+-]*(?:[\\/][A-Za-z0-9_.@()[\]{}+-]+)+):(\d+)(?:-(\d+))?`?/g
const REVISION_FIELDS = ['baseSha', 'baseRevision', 'sourceRevision', 'sourceCommit', 'revision', 'commit']
export const CHECKLIST = {
  instruction: 'Answer every question below for every finding in the report before assigning a verdict.',
  questions: [
    'Does each cited line, read in its displayed context, actually support the stated claim?',
    'Is the finding an observation or an inference, and is it labelled correctly?',
    'Is the finding substantive and non-obvious?',
    'Is the finding independently useful?',
  ],
  verdictVocabulary: ['PASS', 'PASS_WITH_CORRECTIONS', 'FAIL'],
}

export function parseArgs(argv) {
  const options = { json: false, run: null, attempt: null, report: null, source: null }
  for (const arg of argv) {
    if (arg === '--json') {
      if (options.json) throw new Error('--json was provided more than once')
      options.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') return { help: true }
    const match = /^--(run|attempt|report|source)=(.+)$/.exec(arg)
    if (!match) throw new Error(`Unknown or malformed argument: ${arg}\n${USAGE}`)
    if (options[match[1]] !== null) throw new Error(`--${match[1]} was provided more than once`)
    options[match[1]] = match[2]
  }
  if (options.run) {
    if (options.report || options.source) throw new Error('--run cannot be combined with --report or --source')
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.run)) throw new Error(`Invalid run id: ${options.run}`)
    if (options.attempt !== null && !/^[1-9]\d*$/.test(options.attempt)) throw new Error('--attempt must be a positive integer')
    options.attempt = options.attempt === null ? null : Number(options.attempt)
    return options
  }
  if (options.report || options.source) {
    if (!options.report || !options.source) throw new Error('--report and --source must be provided together')
    if (options.attempt !== null) throw new Error('--attempt can only be used with --run')
    return options
  }
  throw new Error(`Choose either --run or --report with --source.\n${USAGE}`)
}

function readJson(path, label) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`Could not read ${label} at ${path}: ${errorMessage(err)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} is not valid JSON: ${path}`)
  }
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function isSensitiveFilename(path) {
  const name = basename(path).toLowerCase()
  return name === 'runner.env.bat' || name.includes('.env')
}

function credentialNotice(text) {
  const credentialName = String.raw`(?:[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential|private[_-]?key)[A-Za-z0-9_]*|database_url|db_url|connection_string)`
  const directAssignment = new RegExp(String.raw`^\s*(?:export\s+|set(?:x)?\s+)?["']?${credentialName}["']?\s*=\s*(.+?)\s*$`, 'i')
  const codeLiteral = new RegExp(String.raw`^\s*(?:const|let|var)\s+${credentialName}\s*=\s*(["'\x60]).+\1\s*;?\s*$`, 'i')
  const propertyLiteral = new RegExp(String.raw`^\s*["']?${credentialName}["']?\s*:\s*(["']).+\1\s*[,}]?\s*$`, 'i')
  for (const line of text.split(/\r\n|\n|\r/)) {
    const direct = directAssignment.exec(line)
    if (direct) {
      const value = direct[1].trim().replace(/^["']|["']$/g, '')
      const reference = /^(?:|null|undefined|REDACTED|<[^>]+>|\$\{?[\w.]+\}?|%[\w.]+%|process\.env\b|import\.meta\.env\b|Deno\.env\b|os\.getenv\b)/i
      if (!reference.test(value)) return 'content contains an apparent credential assignment'
    }
    if (codeLiteral.test(line) || propertyLiteral.test(line)) return 'content contains an apparent credential assignment'
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) return 'content contains an apparent private key'
    if (/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{8,}/i.test(line)) return 'content contains an apparent bearer credential'
  }
  return null
}

function splitLines(text) {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

// Shorthand continuations after a full citation: "file.ts:173, :187, :234" or
// "file.ts:213 and :219". Sticky so it only ever matches right where the full
// citation ended. 1609 live finding: the first real reviewer failed a report for
// three "unresolvable" lines that were written exactly this way and were correct.
const CONTINUATION_PATTERN = /(?:,\s*(?:and\s+)?|\s+and\s+)`?:(\d+)(?:-(\d+))?`?/y
// Guard for the continuation: if the rest of the clause names a path-like
// token ("a/b.ts:10 and :20 of c/d.ts differ"), the shorthand cannot be
// trusted to belong to the last full citation, so it is dropped rather than
// resolved against the wrong file (warden 1609, finding 3).
// The clause ends at punctuation or a bracket (not at a dot, which file names
// contain). The path search runs on the untruncated remainder so a token is
// never cut short, and only a match that starts inside the clause counts. A
// path that is itself a full citation (followed by :line) is unambiguous and
// does not count.
const CLAUSE_END = /[,;:\n()]/
// Either a slash-bearing path or a bare file name with a letters-first
// extension of two or more characters ("review.mjs", not "e.g." or "v1.2").
const PATH_LIKE = /(?<![A-Za-z0-9_.\[\]{}+\\/-])(?:[A-Za-z0-9_.\[\]{}+-]+(?:[\\/][A-Za-z0-9_.()\[\]{}+-]+)+|[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9_.()\[\]{}+\\/-]|:\d)/

function clauseNamesAnotherPath(rest) {
  // Only a match starting inside the 80-character clause window counts, so the
  // search is bounded to a slice long enough for any path that starts there;
  // scanning the whole remainder per continuation was quadratic.
  const head = rest.slice(0, 1024)
  const end = head.search(CLAUSE_END)
  const window = Math.min(end === -1 ? head.length : end, 80)
  const found = PATH_LIKE.exec(head)
  return found !== null && found.index < window
}

export function extractCitations(reportText) {
  const occurrences = []
  for (const match of reportText.matchAll(CITATION_PATTERN)) {
    const startLine = Number(match[2])
    const endLine = match[3] === undefined ? startLine : Number(match[3])
    const citationPath = match[1].replace(/\\/g, '/')
    const display = `${citationPath}:${startLine}${match[3] === undefined ? '' : `-${endLine}`}`
    occurrences.push({ display, path: citationPath, startLine, endLine })
    CONTINUATION_PATTERN.lastIndex = match.index + match[0].length
    let more
    while ((more = CONTINUATION_PATTERN.exec(reportText)) !== null) {
      if (clauseNamesAnotherPath(reportText.slice(more.index + more[0].length))) break
      const moreStart = Number(more[1])
      const moreEnd = more[2] === undefined ? moreStart : Number(more[2])
      occurrences.push({ display: `${citationPath}:${moreStart}${more[2] === undefined ? '' : `-${moreEnd}`}`, path: citationPath, startLine: moreStart, endLine: moreEnd })
    }
  }
  const distinct = []
  const seen = new Set()
  for (const citation of occurrences) {
    if (seen.has(citation.display)) continue
    seen.add(citation.display)
    distinct.push(citation)
  }
  return { total: occurrences.length, distinct }
}

function resolveCitationPath(sourceRoot, citationPath) {
  const normalized = citationPath.replace(/\\/g, '/')
  if (
    normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    return { safe: false, normalized, notice: 'Refused: citation path is absolute or contains traversal.' }
  }
  const resolvedFile = resolve(sourceRoot, ...normalized.split('/'))
  if (!isWithin(sourceRoot, resolvedFile)) {
    return { safe: false, normalized, resolvedFile, notice: 'Refused: citation path escapes the source checkout.' }
  }
  return { safe: true, normalized, resolvedFile }
}

function gitArgs(repository, args) {
  return repository.kind === 'bare_git_dir'
    ? ['--git-dir', repository.path, ...args]
    : ['-C', repository.path, ...args]
}

function gitRead(repository, revision, gitPath, checkOnly = false) {
  const spec = `${revision}:${gitPath}`
  const commandArgs = gitArgs(repository, checkOnly
    ? ['cat-file', '-e', spec]
    : ['show', spec])
  const result = spawnSync('git', commandArgs, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    ok: !result.error && result.status === 0,
    text: result.stdout || '',
    error: result.error?.message || result.stderr?.trim() || '',
  }
}

function assertRevisionAvailable(repository, revision) {
  if (!/^[0-9a-f]{7,64}$/i.test(revision)) {
    throw new Error(`Evidence records an unsafe or unsupported git revision: ${revision}`)
  }
  const result = spawnSync('git', gitArgs(repository, ['cat-file', '-e', `${revision}^{commit}`]), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Evidence records revision ${revision}, but it is not available in git repository ${repository.path}`)
  }
}

function sourceExcerpt(lines, startLine, endLine) {
  const first = Math.max(1, startLine - 3)
  const last = Math.min(lines.length, endLine + 3)
  const width = String(last).length
  const context = []
  for (let number = first; number <= last; number++) {
    context.push({
      line: number,
      cited: number >= startLine && number <= endLine,
      text: lines[number - 1],
    })
  }
  return {
    firstLine: first,
    lastLine: last,
    text: context.map(row => `${row.cited ? '>' : ' '} ${String(row.line).padStart(width)} | ${row.text}`).join('\n'),
    lines: context,
  }
}

function resolveCitation(citation, source) {
  const pathResult = resolveCitationPath(source.root, citation.path)
  const base = {
    citation: citation.display,
    path: pathResult.normalized,
    resolvedFile: pathResult.resolvedFile ?? null,
    citedLine: citation.startLine,
    citedEndLine: citation.endLine,
    pathResolves: false,
    lineExists: false,
    provenance: source.provenance,
    status: 'unresolvable',
    notice: pathResult.notice ?? null,
    context: null,
  }
  if (!pathResult.safe) return base

  let text
  if (source.revision) {
    const result = gitRead(source.repository, source.revision, pathResult.normalized)
    if (!result.ok) return { ...base, notice: 'Path does not resolve to a file at the recorded git revision.' }
    text = result.text
  } else {
    try {
      if (!statSync(pathResult.resolvedFile).isFile()) return { ...base, notice: 'Path resolves, but it is not a file.' }
      const realFile = realpathSync(pathResult.resolvedFile)
      if (!isWithin(source.root, realFile)) {
        return { ...base, notice: 'Refused: resolved file follows a link outside the source checkout.' }
      }
      text = readFileSync(realFile, 'utf8')
    } catch (err) {
      return { ...base, notice: `Path cannot be read from the working tree: ${errorMessage(err)}` }
    }
  }

  const lines = splitLines(text)
  const lineExists = (
    Number.isInteger(citation.startLine)
    && Number.isInteger(citation.endLine)
    && citation.startLine >= 1
    && citation.endLine >= citation.startLine
    && citation.endLine <= lines.length
  )
  if (isSensitiveFilename(pathResult.normalized)) {
    return {
      ...base,
      pathResolves: true,
      lineExists,
      status: 'unsafe',
      notice: 'Source text suppressed: filename matches the protected *.env* / runner.env.bat rule.',
    }
  }
  const sensitive = credentialNotice(text)
  if (sensitive) {
    return {
      ...base,
      pathResolves: true,
      lineExists,
      status: 'unsafe',
      notice: `Source text suppressed: ${sensitive}.`,
    }
  }
  if (!lineExists) {
    return {
      ...base,
      pathResolves: true,
      status: 'out_of_range',
      notice: `Cited line range is outside this file's ${lines.length} line(s).`,
    }
  }
  return {
    ...base,
    pathResolves: true,
    lineExists: true,
    status: 'resolvable',
    notice: null,
    context: sourceExcerpt(lines, citation.startLine, citation.endLine),
  }
}

function findRevision(records) {
  for (const field of REVISION_FIELDS) {
    for (const { label, value } of records) {
      if (!value || typeof value !== 'object') continue
      if (typeof value[field] === 'string' && value[field].trim()) {
        return { revision: value[field].trim(), recordedAs: `${label}.${field}` }
      }
    }
  }
  return null
}

function readAttemptSidecars(runDir, index) {
  const prefix = `attempt-${String(index).padStart(2, '0')}-`
  return readdirSync(runDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ label: entry.name, value: readJson(join(runDir, entry.name), entry.name) }))
}

function parseAttemptShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const attempt = Number.isInteger(value.attempt) && value.attempt > 0 ? value.attempt : null
  const index = Number.isInteger(value.index) && value.index > 0 ? value.index : null
  if (attempt !== null && index !== null && attempt !== index) return null
  return attempt ?? index
}

function discoveredAttempts(runDir) {
  const entries = readdirSync(runDir, { withFileTypes: true })
  const candidates = entries
    .map(entry => ({ entry, match: /^attempt-(\d+)\.json$/.exec(entry.name) }))
    .filter(({ entry, match }) => entry.isFile() && match)
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name))
  const attempts = new Map()
  const unknown = []
  for (const { entry, match } of candidates) {
    const path = join(runDir, entry.name)
    const evidence = readJson(path, entry.name)
    const attempt = parseAttemptShape(evidence)
    if (attempt === null) {
      unknown.push(`${entry.name} (keys: ${Object.keys(evidence ?? {}).join(', ') || 'none'})`)
      continue
    }
    const filenameAttempt = Number(match[1])
    if (attempt !== filenameAttempt) {
      throw new Error(`${entry.name} identifies attempt ${attempt}, but its filename identifies attempt ${filenameAttempt}`)
    }
    if (attempts.has(attempt)) throw new Error(`Duplicate durable evidence for attempt ${attempt} in ${runDir}`)
    attempts.set(attempt, { evidence, path })
  }
  if (!attempts.size) {
    const found = candidates.length
      ? unknown.join('; ')
      : `no attempt-NN.json files; directory entries: ${entries.map(entry => entry.name).join(', ') || '(empty)'}`
    throw new Error(`No attempt files in a known shape were found in ${runDir}; found ${found}. Expected a positive numeric "attempt" or "index" field.`)
  }
  if (unknown.length) {
    throw new Error(`Some attempt files in ${runDir} have an unknown shape: ${unknown.join('; ')}. Expected a positive numeric "attempt" or "index" field.`)
  }
  return new Map([...attempts].sort(([a], [b]) => a - b))
}

function readDurableReport(runDir, index, attemptEvidence) {
  const number = String(index).padStart(2, '0')
  const copies = []
  if (typeof attemptEvidence?.artifactContent === 'string') {
    copies.push({
      source: `attempt-${number}.json#artifactContent`,
      text: attemptEvidence.artifactContent,
      protectedByName: typeof attemptEvidence.artifact === 'string' && isSensitiveFilename(attemptEvidence.artifact),
    })
  }
  for (const path of [join(runDir, 'reports', `${number}.md`), join(runDir, `report-${number}.md`)]) {
    if (existsSync(path) && statSync(path).isFile()) {
      copies.push({ source: path, text: readFileSync(path, 'utf8'), protectedByName: isSensitiveFilename(path) })
    }
  }
  if (!copies.length) throw new Error(`Report for attempt ${index} was not found in durable evidence at ${runDir}`)
  const report = copies[0]
  for (const copy of copies.slice(1)) {
    if (copy.text !== report.text) {
      throw new Error(`Durable report copies disagree for attempt ${index}: ${report.source} and ${copy.source}`)
    }
  }
  if (typeof attemptEvidence?.artifactSha256 === 'string') {
    const actual = createHash('sha256').update(report.text).digest('hex')
    if (actual !== attemptEvidence.artifactSha256) {
      throw new Error(`Report for attempt ${index} does not match artifactSha256 in durable evidence`)
    }
  }
  return report
}

function buildReport({ attempt, evidenceResult, reportSource, reportText, reportProtectedByName = false, source }) {
  const credentialReason = credentialNotice(reportText)
  const unsafeReport = reportProtectedByName || isSensitiveFilename(reportSource) || credentialReason
  const parsed = unsafeReport ? { total: 0, distinct: [] } : extractCitations(reportText)
  const items = parsed.distinct.map(citation => resolveCitation(citation, source))
  const summary = {
    total: parsed.total,
    distinct: items.length,
    resolvable: items.filter(item => item.status === 'resolvable').length,
    unresolvable: items.filter(item => item.status === 'unresolvable' || item.status === 'unsafe').length,
    outOfRange: items.filter(item => item.status === 'out_of_range').length,
  }
  return {
    attempt,
    evidenceResult: evidenceResult ?? null,
    reportSource,
    reportText: unsafeReport ? null : reportText,
    reportNotice: unsafeReport
      ? `Report text suppressed: ${reportProtectedByName || isSensitiveFilename(reportSource) ? 'filename matches the protected file rule' : credentialReason}.`
      : null,
    source: {
      checkout: source.root,
      repository: source.repository,
      provenance: source.provenance,
      fallbackWarning: source.revision
        ? null
        : 'No source revision was recorded; citations were resolved against the current working tree.',
    },
    citations: {
      total: parsed.total,
      distinct: items.length,
      items,
    },
    summary,
  }
}

export function buildRunBundle(options) {
  const runDir = join(RESULTS, options.run)
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    throw new Error(`Run evidence was not found: ${runDir}`)
  }
  const runJsonPath = join(runDir, 'run.json')
  const runEvidence = existsSync(runJsonPath) ? readJson(runJsonPath, 'run evidence') : null
  const found = discoveredAttempts(runDir)
  const attemptNumbers = [...found.keys()]
  const selectedAttempts = options.attempt === null ? attemptNumbers : [options.attempt]
  if (options.attempt !== null && !found.has(options.attempt)) {
    throw new Error(`Attempt ${options.attempt} was not found for run ${options.run}; found: ${attemptNumbers.join(', ')}`)
  }

  const sourceRootPath = join(RUNTIME_RUNS, options.run, 'source')
  if (!existsSync(sourceRootPath) || !statSync(sourceRootPath).isDirectory()) {
    throw new Error(`Source checkout was not found for run ${options.run}: ${sourceRootPath}`)
  }
  const sourceRoot = realpathSync(sourceRootPath)
  const bareRepositoryPath = join(RUNTIME_RUNS, options.run, 'origin.git')
  const revisionRepository = existsSync(bareRepositoryPath) && statSync(bareRepositoryPath).isDirectory()
    ? { kind: 'bare_git_dir', path: realpathSync(bareRepositoryPath) }
    : { kind: 'working_tree', path: sourceRoot }
  const attempts = []
  for (const index of selectedAttempts) {
    const number = String(index).padStart(2, '0')
    const attemptEvidence = found.get(index).evidence
    const runAttempt = Array.isArray(runEvidence?.attempts)
      ? runEvidence.attempts.find(value => value?.index === index) ?? null
      : null
    const sidecars = readAttemptSidecars(runDir, index)
    const revision = findRevision([
      { label: `attempt-${number}.json`, value: attemptEvidence },
      { label: 'run.json attempt', value: runAttempt },
      { label: 'run.json', value: runEvidence },
      ...sidecars,
    ])
    if (revision) assertRevisionAvailable(revisionRepository, revision.revision)
    const report = readDurableReport(runDir, index, attemptEvidence)
    const source = revision
      ? {
          root: sourceRoot,
          repository: revisionRepository,
          revision: revision.revision,
          provenance: {
            kind: 'git_revision',
            revision: revision.revision,
            recordedAs: revision.recordedAs,
            repositoryKind: revisionRepository.kind,
            repositoryPath: revisionRepository.path,
          },
        }
      : {
          root: sourceRoot,
          repository: { kind: 'working_tree', path: sourceRoot },
          revision: null,
          provenance: {
            kind: 'working_tree',
            revision: null,
            recordedAs: null,
            repositoryKind: 'working_tree',
            repositoryPath: sourceRoot,
          },
        }
    attempts.push(buildReport({
      attempt: index,
      evidenceResult: attemptEvidence?.result ?? runAttempt?.result,
      reportSource: report.source,
      reportText: report.text,
      reportProtectedByName: report.protectedByName,
      source,
    }))
  }
  return {
    version: 1,
    mode: 'run',
    runId: options.run,
    runStatus: runEvidence?.status ?? null,
    attemptFilter: options.attempt,
    attempts,
    reviewerChecklist: CHECKLIST,
  }
}

export function buildStandaloneBundle(options) {
  const reportPath = resolve(options.report)
  const sourcePath = resolve(options.source)
  if (!existsSync(reportPath) || !statSync(reportPath).isFile()) throw new Error(`Report was not found: ${reportPath}`)
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) throw new Error(`Source checkout was not found: ${sourcePath}`)
  const reportRealPath = realpathSync(reportPath)
  const sourceRoot = realpathSync(sourcePath)
  const reportText = readFileSync(reportRealPath, 'utf8')
  const source = {
    root: sourceRoot,
    repository: { kind: 'working_tree', path: sourceRoot },
    revision: null,
    provenance: {
      kind: 'working_tree',
      revision: null,
      recordedAs: null,
      repositoryKind: 'working_tree',
      repositoryPath: sourceRoot,
    },
  }
  return {
    version: 1,
    mode: 'standalone',
    runId: null,
    runStatus: null,
    attemptFilter: null,
    attempts: [buildReport({
      attempt: null,
      evidenceResult: null,
      reportSource: reportRealPath,
      reportText,
      reportProtectedByName: isSensitiveFilename(reportRealPath),
      source,
    })],
    reviewerChecklist: CHECKLIST,
  }
}

function fenced(text, language = '') {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(value => value.length))
  const delimiter = '`'.repeat(longest + 1)
  return `${delimiter}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${delimiter}`
}

function yesNoUnknown(value) {
  if (value === null) return 'not checked'
  return value ? 'yes' : 'no'
}

export function markdown(bundle) {
  const lines = ['# Review Bundle', '']
  if (bundle.mode === 'run') {
    lines.push(`- **Run:** \`${bundle.runId}\``)
    lines.push(`- **Run status:** ${bundle.runStatus ?? 'not recorded'}`)
    lines.push(`- **Attempts bundled:** ${bundle.attempts.map(report => report.attempt).join(', ')}`)
  } else {
    lines.push('- **Mode:** standalone report and source checkout')
  }
  lines.push('')

  for (const [reportIndex, report] of bundle.attempts.entries()) {
    const title = report.attempt === null ? 'Standalone Report' : `Report — Attempt ${String(report.attempt).padStart(2, '0')}`
    lines.push(`## ${title}`, '')
    lines.push(`- **Report evidence:** \`${report.reportSource}\``)
    if (report.evidenceResult) lines.push(`- **Mechanical evidence result:** ${report.evidenceResult}`)
    lines.push(`- **Source checkout:** \`${report.source.checkout}\``)
    if (report.source.provenance.kind === 'git_revision') {
      lines.push(`- **Source provenance:** git revision \`${report.source.provenance.revision}\` (recorded as \`${report.source.provenance.recordedAs}\`)`)
      lines.push(`- **Git repository:** ${report.source.provenance.repositoryKind === 'bare_git_dir' ? 'bare git directory' : 'working-tree repository'} \`${report.source.provenance.repositoryPath}\``)
    } else {
      lines.push('- **Source provenance:** **WORKING TREE FALLBACK — no revision was recorded. Later checkout changes may affect this review.**')
    }
    lines.push('', '### Full report', '')
    if (report.reportText === null) {
      lines.push(`> **SKIPPED:** ${report.reportNotice}`)
    } else {
      lines.push(fenced(report.reportText, 'markdown'))
    }
    lines.push('', '### Citations', '')
    lines.push(`Total citation occurrences: **${report.citations.total}**  `)
    lines.push(`Distinct citations: **${report.citations.distinct}**`)
    lines.push('')

    if (!report.citations.items.length) lines.push('_No citations were available for review._', '')
    for (const [index, citation] of report.citations.items.entries()) {
      lines.push(`#### ${index + 1}. \`${citation.citation}\``, '')
      lines.push(`- **Resolved file:** ${citation.resolvedFile ? `\`${citation.resolvedFile}\`` : 'none'}`)
      lines.push(`- **Cited line${citation.citedEndLine === citation.citedLine ? '' : ' range'}:** ${citation.citedLine}${citation.citedEndLine === citation.citedLine ? '' : `–${citation.citedEndLine}`}`)
      lines.push(`- **Path resolves:** ${yesNoUnknown(citation.pathResolves)}`)
      lines.push(`- **Line exists:** ${yesNoUnknown(citation.lineExists)}`)
      lines.push(`- **Status:** ${citation.status}`)
      if (citation.provenance.kind === 'git_revision') {
        lines.push(`- **Read from:** git revision \`${citation.provenance.revision}\` via ${citation.provenance.repositoryKind === 'bare_git_dir' ? '`git --git-dir`' : '`git -C`'}`)
      } else {
        lines.push('- **Read from:** working tree fallback (no recorded revision)')
      }
      if (citation.notice) lines.push(`- **Notice:** ${citation.notice}`)
      if (citation.context) {
        lines.push('', fenced(citation.context.text, 'text'))
      }
      lines.push('')
    }

    lines.push('### Per-report summary', '')
    lines.push('| Total | Distinct | Resolvable | Unresolvable | Out of range |')
    lines.push('| ---: | ---: | ---: | ---: | ---: |')
    lines.push(`| ${report.summary.total} | ${report.summary.distinct} | ${report.summary.resolvable} | ${report.summary.unresolvable} | ${report.summary.outOfRange} |`)
    lines.push('')
    if (reportIndex < bundle.attempts.length - 1) lines.push('---', '')
  }

  lines.push('## REVIEWER CHECKLIST', '')
  lines.push(`**Required process:** ${bundle.reviewerChecklist.instruction}`, '')
  for (const [index, question] of bundle.reviewerChecklist.questions.entries()) {
    lines.push(`${index + 1}. ${question}`)
  }
  lines.push('', `**Required verdict vocabulary:** ${bundle.reviewerChecklist.verdictVocabulary.map(value => `\`${value}\``).join(', ')}`, '')
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const bundle = options.run ? buildRunBundle(options) : buildStandaloneBundle(options)
  console.log(options.json ? JSON.stringify(bundle, null, 2) : markdown(bundle))
}

// Guarded so run.mjs / review.mjs can import buildRunBundle and markdown
// without the CLI executing on import. CLI behaviour is unchanged.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`review-bundle: ${errorMessage(err)}`)
    process.exitCode = 1
  })
}
