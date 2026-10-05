// Repo slugs arrive from session hooks in several shapes ('shadow_app_aeon',
// 'sefe/Short Term Power/stp_app_ermac', a worktree or run folder name). The
// scorer keys repos on the lowercase last path segment and drops names that
// are not a repo at all (living_dominions.md technical appendix).

const JUNK_EXACT: ReadonlySet<string> = new Set([
  'dev_26',
  'data_science',
  'tmp',
  'temp',
  'unknown',
  'null',
  'undefined',
])

const JUNK_PATTERNS: readonly RegExp[] = [
  /^\./,
  /worktree/,
  /(^|[-_])smoke([-_]|$)/,
  /^[a-z]+-(low|medium|high|xhigh|max)-\d+$/,
  /^(run|wt|tmp)[-_]/,
]

export function normalizeRepoSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const segments = raw.trim().split(/[\\/]+/).filter((s) => s.trim() !== '')
  const last = segments.at(-1)?.trim().toLowerCase().replace(/\.git$/, '')
  if (!last) return null
  if (JUNK_EXACT.has(last)) return null
  if (JUNK_PATTERNS.some((p) => p.test(last))) return null
  return last
}
