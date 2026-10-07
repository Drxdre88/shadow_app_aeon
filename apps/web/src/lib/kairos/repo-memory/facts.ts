// The compact facts line a nightly lessons prompt shows per session, read from
// the capture record already stored on the session memory (sourceMetadata
// .session, or the hook's top-level commits / filesTouched). Counts and
// subjects only — never diff text.

export const REPO_SESSION_FACTS_MAX = 400
const COMMITS_SHOWN = 5
const FILES_SHOWN = 5
const SUBJECT_MAX = 80
const OUTCOME_MAX = 120

export interface SessionFacts {
  commits: string[]
  commitCount: number
  prs: Array<{ number: number; action: string }>
  tests: { status: string; summary?: string } | null
  errorCount: number | null
  linesAdded: number | null
  linesRemoved: number | null
  files: string[]
  fileCount: number
  status: string | null
  outcome: string | null
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const flat = v.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Null when the record carries nothing worth a facts line. */
export function parseSessionFacts(raw: unknown): SessionFacts | null {
  const o = obj(raw)
  if (!o) return null
  const commitsRaw = Array.isArray(o.commits) ? o.commits : []
  const commits = commitsRaw.flatMap((c) => text(obj(c)?.subject, SUBJECT_MAX) ?? [])
  const prs = (Array.isArray(o.prs) ? o.prs : []).flatMap((p) => {
    const r = obj(p)
    const n = int(r?.number)
    return n === null ? [] : [{ number: n, action: text(r?.action, 20) ?? 'touched' }]
  })
  const t = obj(o.tests)
  const tests = t && typeof t.status === 'string'
    ? { status: t.status, ...(text(t.summary, 100) ? { summary: text(t.summary, 100)! } : {}) }
    : null
  const files = (Array.isArray(o.files) ? o.files : []).filter((f): f is string => typeof f === 'string' && f.trim() !== '')
  const facts: SessionFacts = {
    commits: commits.slice(0, COMMITS_SHOWN),
    commitCount: commitsRaw.length,
    prs,
    tests,
    errorCount: int(o.errorCount),
    linesAdded: int(o.linesAdded),
    linesRemoved: int(o.linesRemoved),
    files: [...new Set(files.map(baseName))].slice(0, FILES_SHOWN),
    fileCount: files.length,
    status: text(o.status, 30),
    outcome: text(o.outcome, OUTCOME_MAX),
  }
  const empty = !facts.commitCount && !prs.length && !tests && !facts.errorCount && !facts.fileCount
    && facts.linesAdded === null && !facts.status && !facts.outcome
  return empty ? null : facts
}

/** One line, at most REPO_SESSION_FACTS_MAX chars; '' when there are no facts. */
export function formatSessionFacts(f: SessionFacts | null | undefined): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.commitCount) {
    const more = f.commitCount > f.commits.length ? `; +${f.commitCount - f.commits.length} more` : ''
    parts.push(`${f.commitCount} commit${f.commitCount === 1 ? '' : 's'}${f.commits.length ? ` (${f.commits.map((s) => `"${s}"`).join('; ')}${more})` : ''}`)
  }
  for (const p of f.prs.slice(0, 3)) parts.push(`PR #${p.number} ${p.action}`)
  if (f.tests) parts.push(`tests ${f.tests.status}${f.tests.summary ? ` (${f.tests.summary})` : ''}`)
  if (f.errorCount) parts.push(`${f.errorCount} tool error${f.errorCount === 1 ? '' : 's'}`)
  if (f.linesAdded !== null || f.linesRemoved !== null) parts.push(`+${f.linesAdded ?? 0}/−${f.linesRemoved ?? 0} lines`)
  if (f.fileCount) {
    const more = f.fileCount > f.files.length ? ` (+${f.fileCount - f.files.length} more)` : ''
    parts.push(`files: ${f.files.join(', ')}${more}`)
  }
  if (f.status || f.outcome) parts.push(`mission ${[f.status, f.outcome].filter(Boolean).join(' — ')}`)
  const line = parts.join(' · ')
  return line.length > REPO_SESSION_FACTS_MAX ? `${line.slice(0, REPO_SESSION_FACTS_MAX - 1)}…` : line
}
