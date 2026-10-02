// Pure helpers for the Aeon living-world freshness check (scripts/aeon-freshness.mjs).
// No file system, git or network here; the runner does the IO and passes text in,
// so every rule can be unit-tested with fixtures (scripts/__tests__/).

export const LEVEL_ICON = { green: '🟢', yellow: '🟡', red: '🔴' }
const LEVEL_RANK = { green: 0, yellow: 1, red: 2 }

export function finding(level, message, details = []) {
  return { level, message, details }
}

export function worstLevel(findings) {
  return findings.reduce((w, f) => (LEVEL_RANK[f.level] > LEVEL_RANK[w] ? f.level : w), 'green')
}

/** Whole days from date `from` to date `to` (ISO strings or Dates). Negative if `to` is earlier. */
export function daysBetween(from, to) {
  const a = from instanceof Date ? from.getTime() : Date.parse(from)
  const b = to instanceof Date ? to.getTime() : Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.floor((b - a) / 86_400_000)
}

/** green ≤ yellowAfter < yellow ≤ redAfter < red. NaN (unparseable date) is red. */
export function ageLevel(days, yellowAfter, redAfter) {
  if (Number.isNaN(days)) return 'red'
  if (days > redAfter) return 'red'
  if (days > yellowAfter) return 'yellow'
  return 'green'
}

// ---------------------------------------------------------------- glob matching

/** Minimal glob → RegExp: `**` spans directories, `*` and `?` stay within one segment. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(path, globs) {
  const p = path.replace(/\\/g, '/')
  return globs.some((g) => globToRegExp(g).test(p))
}

// ---------------------------------------------------------------- models

// A model id literal: a quoted string naming a Claude / GPT / Gemini / o-series
// model. Requires a digit so tool names like 'claude-code' are not model ids, and is
// case-sensitive so display labels ('GPT-5.4') are not ids either.
const MODEL_LITERAL_RE =
  /['"`]((?:claude|gpt|gemini)-(?=[a-z0-9.-]*\d)[a-z0-9.-]+|o\d(?:-[a-z0-9-]+)?)['"`]/g

/** Returns [{ id, line }] for every model-id literal in `text`. */
export function extractModelLiterals(text) {
  const out = []
  text.split(/\r?\n/).forEach((ln, idx) => {
    if (ln.includes('freshness-ignore')) return
    for (const m of ln.matchAll(MODEL_LITERAL_RE)) out.push({ id: m[1], line: idx + 1 })
  })
  return out
}

function collectStrings(value, into) {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, into))
  return into
}

function entryIds(m) {
  return [m.id, ...collectStrings([m.aliases ?? [], m.apiIds ?? [], m.engineIds ?? {}], [])].filter(Boolean)
}

/** Ids of registry models that are not legacy, with their aliases / apiIds / engineIds. */
export function currentModelIds(registry) {
  const ids = new Set()
  for (const m of registry?.models ?? []) if (m?.id && m.status !== 'legacy') entryIds(m).forEach((s) => ids.add(s))
  return ids
}

/** Retired ids the registry still knows: legacy model entries and every `legacyRemap` key. */
export function retiredModelIds(registry) {
  const ids = new Set(Object.keys(registry?.legacyRemap ?? {}))
  for (const m of registry?.models ?? []) if (m?.id && m.status === 'legacy') entryIds(m).forEach((s) => ids.add(s))
  const current = currentModelIds(registry)
  for (const id of current) ids.delete(id)
  return ids
}

/**
 * Models check. `literalHits` is [{ file, line, id }] from the source scan.
 * Returns findings for registry age, legacy defaults, retired literals and unregistered literals.
 */
export function checkModels(registry, now, literalHits = [], { yellowDays = 45, redDays = 90 } = {}) {
  if (!registry) {
    return [finding('yellow', 'Model registry not found (packages/shared/src/ai/model-registry.json) — model checks skipped.')]
  }
  const findings = []
  const age = daysBetween(registry.reviewedAt ?? '', now)
  findings.push(
    finding(
      ageLevel(age, yellowDays, redDays),
      Number.isNaN(age)
        ? `Registry reviewedAt is missing or unparseable (${JSON.stringify(registry.reviewedAt)}).`
        : `Registry last reviewed ${registry.reviewedAt} (${age} day(s) ago; 🟡 > ${yellowDays}, 🔴 > ${redDays}).`,
    ),
  )

  const retired = retiredModelIds(registry)
  const legacyDefaults = [...new Set(collectStrings(registry.defaults ?? {}, []).filter((id) => retired.has(id)))]
  findings.push(
    legacyDefaults.length
      ? finding('yellow', `${legacyDefaults.length} legacy model(s) still used as defaults.`, legacyDefaults)
      : finding('green', 'No legacy model is used as a default.'),
  )

  const current = currentModelIds(registry)
  const fmt = (h) => `${h.file}:${h.line} — \`${h.id}\`${retired.has(h.id) && registry.legacyRemap?.[h.id] ? ` → ${registry.legacyRemap[h.id]}` : ''}`
  const old = literalHits.filter((h) => retired.has(h.id))
  const unknown = literalHits.filter((h) => !current.has(h.id) && !retired.has(h.id))
  findings.push(
    old.length
      ? finding('yellow', `${old.length} retired model id literal(s) still in source (registry remaps them).`, old.map(fmt))
      : finding('green', 'No retired model id literals in source.'),
  )
  findings.push(
    unknown.length
      ? finding('yellow', `${unknown.length} unregistered model literal(s) in source.`, unknown.map(fmt))
      : finding('green', `All ${literalHits.length} model literal(s) in source are registered.`),
  )
  return findings
}

// ---------------------------------------------------------------- retired terms

/** The model-id-shaped token starting at `idx` (trailing dots dropped), lowercased. */
function tokenAt(low, idx) {
  const m = low.slice(idx).match(/^[a-z0-9.-]+/)
  return m ? m[0].replace(/\.+$/, '') : ''
}

/**
 * files: [{ path, text }]. config: { terms, scan, allow, ignoreLines? }.
 * Returns [{ path, line, term, excerpt }] for files matching `scan` and not `allow`.
 * Matching is case-insensitive substring. A line matching any `ignoreLines` regex is
 * skipped (history notes such as "… retired in 0.17"). An occurrence whose whole token
 * is a current registry model id (`currentModelIds`) is not stale — e.g. the term
 * "gpt-5." must not flag a model the registry still lists as current.
 */
export function scanRetiredTerms(files, config, { currentModelIds = new Set() } = {}) {
  const terms = config.terms ?? []
  const lowered = terms.map((t) => t.toLowerCase())
  const ignore = (config.ignoreLines ?? []).map((r) => new RegExp(r, 'i'))
  const current = new Set([...currentModelIds].map((s) => s.toLowerCase()))
  const hits = []
  for (const f of files) {
    const p = f.path.replace(/\\/g, '/')
    if (!matchesAny(p, config.scan ?? [])) continue
    if (matchesAny(p, config.allow ?? [])) continue
    f.text.split(/\r?\n/).forEach((ln, idx) => {
      if (ignore.some((r) => r.test(ln))) return
      const low = ln.toLowerCase()
      lowered.forEach((t, ti) => {
        for (let at = low.indexOf(t); at !== -1; at = low.indexOf(t, at + 1)) {
          if (current.has(tokenAt(low, at))) continue
          hits.push({ path: p, line: idx + 1, term: terms[ti], excerpt: ln.trim().slice(0, 140) })
          break
        }
      })
    })
  }
  return hits
}

export function checkRetiredTerms(hits) {
  if (!hits.length) return [finding('green', 'No retired terms in user-facing guides and docs.')]
  return [
    finding(
      'yellow',
      `${hits.length} retired-term hit(s) in user-facing guides and docs.`,
      hits.map((h) => `${h.path}:${h.line} — "${h.term}" — ${h.excerpt}`),
    ),
  ]
}

// ---------------------------------------------------------------- architecture

/** Newest YYYY-MM-DD found in a `### YYYY-MM-DD` heading. */
export function newestHistoryDate(md) {
  let best = null
  for (const m of md.matchAll(/^###\s+(\d{4}-\d{2}-\d{2})/gm)) if (!best || m[1] > best) best = m[1]
  return best
}

export function checkArchitectureLag(historyDate, commitDate, { yellowDays = 14, redDays = 30 } = {}) {
  if (!historyDate) return [finding('red', 'No dated entry found in architecture/history.md.')]
  if (!commitDate) return [finding('green', `architecture/history.md newest entry ${historyDate}; no feat/fix commit date found.`)]
  const lag = Math.max(0, daysBetween(historyDate, commitDate))
  return [
    finding(
      ageLevel(lag, yellowDays, redDays),
      `architecture/history.md newest entry ${historyDate}; newest feat/fix commit touching apps/ ${commitDate} → ${lag} day(s) behind (🟡 > ${yellowDays}, 🔴 > ${redDays}).`,
    ),
  ]
}

/** folders: [{ prefix: 'lib', name: 'kairos' }]. Returns those whose `prefix/name` never appears in docText. */
export function unmentionedFolders(folders, docText) {
  return folders.filter(({ prefix, name }) => !docText.includes(`${prefix}/${name}`))
}

// ---------------------------------------------------------------- versions

export function topChangelogVersion(md) {
  const m = md.match(/^## \[([^\]]+)\]/m)
  return m ? m[1] : null
}

export function constVersion(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`))
  return m ? m[1] : null
}

/** pairs: [{ label, values: { source: version|null } }] — all values in a pair must be present and equal. */
export function checkVersions(pairs) {
  return pairs.map(({ label, values }) => {
    const entries = Object.entries(values)
    const shown = entries.map(([k, v]) => `${k} = ${v ?? 'missing'}`).join(' · ')
    const vals = entries.map(([, v]) => v)
    const ok = vals.every((v) => v != null) && new Set(vals).size === 1
    return finding(ok ? 'green' : 'red', `${label}: ${ok ? 'consistent' : 'MISMATCH'} (${shown}).`)
  })
}

// ---------------------------------------------------------------- dependencies

export const IMPORTANT_DEPS = ['next', 'react', 'react-dom', 'ai', '@ai-sdk/*', 'drizzle-orm', 'next-auth', 'typescript', 'vitest']

function parseSemver(v) {
  const m = String(v ?? '').match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? m.slice(1, 4).map(Number) : null
}

/** 'major' | 'minor' | 'patch' | 'none' | 'unknown'. For 0.x, a minor bump counts as major (semver). */
export function bumpKind(current, latest) {
  const a = parseSemver(current)
  const b = parseSemver(latest)
  if (!a || !b) return 'unknown'
  if (b[0] !== a[0]) return b[0] > a[0] ? 'major' : 'none'
  if (b[1] !== a[1]) return b[1] > a[1] ? (a[0] === 0 ? 'major' : 'minor') : 'none'
  return b[2] > a[2] ? 'patch' : 'none'
}

function importanceRank(name) {
  return IMPORTANT_DEPS.findIndex((p) => (p.endsWith('/*') ? name.startsWith(p.slice(0, -1)) : name === p))
}

/**
 * Summarise `npm outdated --json --workspaces` output. Values may be an object or,
 * when several workspaces depend on the package, an array of objects.
 */
export function summariseOutdated(json) {
  const merged = new Map()
  for (const [name, raw] of Object.entries(json ?? {})) {
    for (const e of Array.isArray(raw) ? raw : [raw]) {
      if (!e || !e.current) continue // not installed — nothing to compare
      const key = `${name}@${e.current}->${e.latest}`
      const prev = merged.get(key)
      if (prev) {
        if (e.dependent && !prev.dependents.includes(e.dependent)) prev.dependents.push(e.dependent)
      } else {
        merged.set(key, {
          name,
          current: e.current,
          latest: e.latest,
          dependents: e.dependent ? [e.dependent] : [],
          kind: bumpKind(e.current, e.latest),
        })
      }
    }
  }
  const rows = [...merged.values()].filter((r) => r.kind !== 'none')
  const important = rows
    .filter((r) => importanceRank(r.name) >= 0)
    .sort((x, y) => importanceRank(x.name) - importanceRank(y.name) || x.name.localeCompare(y.name))
    .slice(0, 10)
  return {
    total: rows.length,
    majors: rows.filter((r) => r.kind === 'major').length,
    minors: rows.filter((r) => r.kind === 'minor').length,
    important,
  }
}

export function checkDependencies(summary) {
  const level = summary.important.some((r) => r.kind === 'major') ? 'yellow' : 'green'
  return [
    finding(
      level,
      `${summary.total} outdated package(s): ${summary.majors} major behind, ${summary.minors} minor behind.`,
      summary.important.map(
        (r) => `${r.name} ${r.current} → ${r.latest} (${r.kind}${r.dependents.length ? `; ${r.dependents.join(', ')}` : ''})`,
      ),
    ),
  ]
}

// ---------------------------------------------------------------- report

/** sections: [{ title, note?, findings }] */
export function renderReport(sections, { generatedAt, maxDetails = 40 } = {}) {
  const all = sections.flatMap((s) => s.findings)
  const counts = { green: 0, yellow: 0, red: 0 }
  for (const f of all) counts[f.level]++
  const summary = `🟢 ${counts.green} · 🟡 ${counts.yellow} · 🔴 ${counts.red}`
  const out = ['# Aeon living world — freshness report', '']
  if (generatedAt) out.push(`Generated ${generatedAt}.`, '')
  out.push(`**Summary:** ${summary}`, '')
  for (const s of sections) {
    out.push(`## ${LEVEL_ICON[worstLevel(s.findings)]} ${s.title}`, '')
    if (s.note) out.push(`_${s.note}_`, '')
    for (const f of s.findings) {
      out.push(`- ${LEVEL_ICON[f.level]} ${f.message}`)
      for (const d of f.details.slice(0, maxDetails)) out.push(`  - ${d}`)
      if (f.details.length > maxDetails) out.push(`  - … and ${f.details.length - maxDetails} more`)
    }
    out.push('')
  }
  out.push('What to do per finding: see docs/aeon-living-world.md')
  return { markdown: out.join('\n') + '\n', summary, counts }
}
