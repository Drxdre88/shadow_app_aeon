/**
 * Life-chapters firewall (wave 4 lane E). A chapter is Kairos's own story
 * told from what happened; measurement never becomes part of it.
 *
 * (a) Life-chapter modules import nothing from dreams, character, cold-read,
 *     surprise, stage, conscience probes/context, or the data modules behind
 *     them (character runs, cold reads, voice samples, drift, dreams, Health).
 * (b) They never name a banned reader or a measurement kind literal.
 * (c) Every `->>'kind' =` filter in the data module is allowlisted.
 * (d) Nothing under dreams/, character/ or cold-read/ imports life chapters.
 * (e) At runtime, planning reads no forbidden source and no planted marker
 *     reaches the prompt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../../..')
const LC_DIR = path.join(SRC, 'lib/kairos/life-chapters')
const HANDLER = path.join(SRC, 'lib/kairos/thinking/handlers/life-chapter.ts')
const DATA = path.join(SRC, 'lib/data/life-chapters.ts')
const VALIDATOR = path.join(SRC, 'lib/data/validators/kairos-life-chapters.ts')
const read = (p: string) => readFileSync(p, 'utf8')
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => (m[1] ?? m[2]) as string)
}

// Absolute, extensionless target of an import specifier, or null for packages.
function resolveSpecifier(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return path.join(SRC, spec.slice(2))
  if (spec.startsWith('.')) return path.resolve(path.dirname(file), spec)
  return null
}

const guardedFiles = () => [...sourceFiles(LC_DIR), HANDLER, DATA, VALIDATOR]

// ── (a) ───────────────────────────────────────────────────────────────────

const FORBIDDEN_TARGETS: readonly RegExp[] = [
  /^lib\/kairos\/(dreams|character|cold-read|surprise|stage)(\/|$)/,
  /^lib\/kairos\/constitution\/conscience-probes$/,
  /^lib\/kairos\/conscience-context$/,
  /^lib\/data\/(character|cold-reads|voice-samples|constitution-drift|kairos-surprise|surprise-marks|kairos-stage|brain-status|dream-[\w-]+)$/,
  /^lib\/actions\/kairos-brain$/,
]

const targetRel = (file: string, spec: string) => {
  const t = resolveSpecifier(file, spec)
  return t === null ? null : rel(t)
}

describe('(a) life-chapter modules import no measurement or fiction source', () => {
  it('there are modules to guard', () => {
    expect(sourceFiles(LC_DIR).length).toBeGreaterThan(3)
    for (const f of [HANDLER, DATA, VALIDATOR]) expect(existsSync(f), rel(f)).toBe(true)
  })

  it('no guarded file imports a forbidden module', () => {
    for (const file of guardedFiles()) {
      for (const spec of importSpecifiers(read(file))) {
        const target = targetRel(file, spec)
        if (target === null) continue
        expect(FORBIDDEN_TARGETS.some((re) => re.test(target)), `${rel(file)} imports ${spec}`).toBe(false)
      }
    }
  })

  it('the guard catches alias and relative forms', () => {
    const cases: Array<[string, string]> = [
      [HANDLER, '@/lib/kairos/character/flag'],
      [HANDLER, '../../cold-read/stance'],
      [HANDLER, '@/lib/data/constitution-drift'],
      [path.join(LC_DIR, 'inputs.ts'), '../dreams/line'],
      [path.join(LC_DIR, 'inputs.ts'), '../stage'],
      [DATA, './cold-reads'],
      [DATA, '../kairos/conscience-context'],
    ]
    for (const [file, spec] of cases) expect(FORBIDDEN_TARGETS.some((re) => re.test(targetRel(file, spec)!)), spec).toBe(true)
    expect(FORBIDDEN_TARGETS.some((re) => re.test(targetRel(DATA, './belief-diff')!))).toBe(false)
  })
})

// ── (b) ───────────────────────────────────────────────────────────────────

const BANNED_NAMES = /\b(findLatestConscienceRun|findLatestDriftRun|readStoredConscience|conscienceFailureLine|characterLine|summariseCharacterRuns|listCharacterRuns|listColdReads|summariseColdReads|listApprovedVoiceSamples|readKairosSurprise|recordSurprise|readDreamLine|stageMode|loadConscienceContext)\b/
const BANNED_LITERALS = /['"`](drift_run|drift_baseline|character_run|cold_read|voice_sample|dream|dream_read)['"`]/

describe('(b) no banned reader name or measurement kind literal', () => {
  it.each(guardedFiles().map(rel))('%s', (file) => {
    const src = read(path.join(SRC, file))
    expect(src).not.toMatch(BANNED_NAMES)
    expect(src).not.toMatch(BANNED_LITERALS)
  })
})

// ── (c) ───────────────────────────────────────────────────────────────────

const KIND_FILTER_ALLOWLIST = new Set(['LIFE_CHAPTER_OBSERVATION_KIND', 'WEEKLY_REVIEW_OBSERVATION_KIND', 'life_chapter', 'weekly_review'])

describe('(c) every kind filter in the data module is allowlisted', () => {
  it('only life_chapter and weekly_review rows are selected by kind', () => {
    const src = read(DATA)
    const filters = [...src.matchAll(/->>'kind' = (?:'([\w-]+)'|\$\{(\w+)\})/g)].map((m) => m[1] ?? m[2])
    expect(filters.length).toBeGreaterThan(0)
    for (const f of filters) expect(KIND_FILTER_ALLOWLIST.has(f), f).toBe(true)
    expect(src).toMatch(/export const LIFE_CHAPTER_OBSERVATION_KIND = 'life_chapter'/)
    expect(src).toMatch(/export const WEEKLY_REVIEW_OBSERVATION_KIND = 'weekly_review'/)
  })
})

// ── (d) ───────────────────────────────────────────────────────────────────

const LC_TARGETS = [rel(LC_DIR), rel(DATA).replace(/\.ts$/, ''), rel(HANDLER).replace(/\.ts$/, '')]

describe('(d) measurement and fiction modules never import life chapters', () => {
  it('nothing under dreams/, character/ or cold-read/ does', () => {
    const files = ['lib/kairos/dreams', 'lib/kairos/character', 'lib/kairos/cold-read'].flatMap((d) => sourceFiles(path.join(SRC, d)))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const spec of importSpecifiers(read(file))) {
        const target = targetRel(file, spec)
        if (target === null) continue
        expect(LC_TARGETS.some((t) => target === t || target.startsWith(`${t}/`)), `${rel(file)} imports ${spec}`).toBe(false)
      }
    }
  })
})

// ── (e) runtime ───────────────────────────────────────────────────────────

const MARK = 'FORBIDDEN-MARKER-7f3a'
const forbidden = vi.hoisted(() => ({
  findLatestDriftRun: vi.fn(async () => ({ id: 'drift', summary: 'FORBIDDEN-MARKER-7f3a' })),
  listColdReads: vi.fn(async () => [{ id: 'cold', coldRead: { stance: 'FORBIDDEN-MARKER-7f3a' } }]),
  listCharacterRuns: vi.fn(async () => [{ id: 'char', sourceMetadata: { note: 'FORBIDDEN-MARKER-7f3a' } }]),
  listApprovedVoiceSamples: vi.fn(async () => [{ id: 'voice', text: 'FORBIDDEN-MARKER-7f3a' }]),
  readKairosSurprise: vi.fn(async () => ({ events: [{ kind: 'contradiction', key: 'FORBIDDEN-MARKER-7f3a' }] })),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/constitution-drift', () => ({ findLatestDriftRun: forbidden.findLatestDriftRun }))
vi.mock('@/lib/data/cold-reads', () => ({ listColdReads: forbidden.listColdReads }))
vi.mock('@/lib/data/character', () => ({ listCharacterRuns: forbidden.listCharacterRuns }))
vi.mock('@/lib/data/voice-samples', () => ({ listApprovedVoiceSamples: forbidden.listApprovedVoiceSamples }))
vi.mock('@/lib/data/kairos-surprise', () => ({ readKairosSurprise: forbidden.readKairosSurprise }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(async () => false) }))
vi.mock('@/lib/data/belief-diff', () => ({ listBeliefDiffOps: vi.fn(async () => []) }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: vi.fn(async () => ({ open: [], closed: [] })) }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn(async () => ({ open: [], closed: [] })) }))
vi.mock('@/lib/data/life-chapters', () => ({
  listWeeklyReviewsOverlapping: vi.fn(async () => [
    { id: 'rev-1', isoWeek: '2026-W36', summary: 'Shipped billing.', wins: [], drift: [] },
    { id: 'rev-2', isoWeek: '2026-W37', summary: 'Stalled on auth.', wins: [], drift: [] },
  ]),
  listGoalsTouchedBetween: vi.fn(async () => [{ id: 'goal-1', title: 'Fix auth', state: 'failed', at: '2026-09-20T00:00:00.000Z' }]),
  listConstitutionVersionsBetween: vi.fn(async () => []),
  findAetherNarrativeBefore: vi.fn(async () => null),
  findLatestLifeChapterBefore: vi.fn(async () => ({
    id: 'prev', externalKey: 'life_chapter:2026-08', createdAt: new Date(),
    chapter: {
      v: 1, month: '2026-08', window: { start: 'a', end: 'b' }, title: 'August', summary: 'A quiet month.',
      turningPoints: [], whatChanged: [], unresolved: ['auth'], citations: ['secret-cite'], inputCounts: {}, lintHits: 4242, jobId: 'j', answeredBy: 'routine',
    },
  })),
}))

describe('(e) planning reads no forbidden source', () => {
  beforeEach(() => { process.env.KAIROS_LIFE_CHAPTERS = '1' })
  afterEach(() => { delete process.env.KAIROS_LIFE_CHAPTERS })

  it('builds the prompt from allowed sources only', async () => {
    const { lifeChapterHandler } = await import('@/lib/kairos/thinking/handlers/life-chapter')
    const [spec] = await lifeChapterHandler.plan('u1', new Date('2026-10-01T13:00:00Z'))
    expect(spec?.externalKey).toBe('life_chapter:2026-09')
    for (const fn of Object.values(forbidden)) expect(fn).not.toHaveBeenCalled()
    const all = `${spec.input.system}\n${spec.input.prompt}`
    expect(all).not.toContain(MARK)
    expect(all).not.toContain('4242')
    expect(all).not.toContain('secret-cite')
    expect(spec.input.validMemoryIds).not.toContain('prev')
  })
})
