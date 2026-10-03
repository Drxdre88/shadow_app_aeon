/**
 * Dreams firewall (wave 2b). Dream text is fiction: it lives only in job
 * output and may surface only as the Telegram-only morning line, the redacted
 * job listing and the conscience echo audit.
 *
 * (a) Dream modules reach no memory, reaction, prediction, promise, goal,
 *     agenda, speak or today writer, and never put a raw excerpt in a trace.
 * (b) Only the allowlisted consumers import the dreams modules; retrieval,
 *     dialogue, chat, belief, idea, ask-mine, cortex, aether and today never do.
 * (c) No dream module writes rows directly or imports a data-layer writer.
 * (d) The 06:00 prompt path never reads a dream; the line rides only as the
 *     Telegram tail.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../../..')
const DREAMS_DIR = path.join(SRC, 'lib/kairos/dreams')
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

const importsDreams = (file: string) =>
  importSpecifiers(read(file)).some((spec) => {
    const target = resolveSpecifier(file, spec)
    return target !== null && (target === DREAMS_DIR || target.startsWith(DREAMS_DIR + path.sep))
  })

const dreamHandlerFiles = () =>
  sourceFiles(path.join(SRC, 'lib/kairos/thinking/handlers')).filter((f) => /[\\/]dream[^\\/]*\.ts$/.test(f))
const dreamDataFiles = () => sourceFiles(path.join(SRC, 'lib/data')).filter((f) => /[\\/]dream-[^\\/]*\.ts$/.test(f))
const dreamFiles = () => [...sourceFiles(DREAMS_DIR), ...dreamHandlerFiles()]

// ── (a) ───────────────────────────────────────────────────────────────────

const FORBIDDEN_IDENTIFIERS = /\b(captureMemory|createMemory|captureReflection)\b/
const FORBIDDEN_MODULES: readonly RegExp[] = [
  /(^|\/)(reactions|memory-reactions|memory-ops)$/,
  /(^|\/)(predictions|promises|agenda)\/create$/,
  /(^|\/)goals\/transitions$/,
  /(^|\/)speak$/,
  /(^|\/)today(-[\w-]+)?$/,
]

describe('(a) dream modules reach no writer', () => {
  it('there are dream modules to guard', () => {
    expect(sourceFiles(DREAMS_DIR).length).toBeGreaterThan(0)
  })

  it('no dream module names a memory writer, imports a forbidden module or sets rawExcerpt', () => {
    for (const file of dreamFiles()) {
      const src = read(file)
      expect(src, `${rel(file)} names a memory writer`).not.toMatch(FORBIDDEN_IDENTIFIERS)
      expect(src, `${rel(file)} puts a raw excerpt in a trace`).not.toMatch(/\brawExcerpt\b/)
      for (const spec of importSpecifiers(src)) {
        for (const re of FORBIDDEN_MODULES) expect(spec, `${rel(file)} imports ${spec}`).not.toMatch(re)
      }
    }
  })

  it('the guard itself would catch each forbidden import', () => {
    for (const spec of ['@/lib/kairos/reactions', '@/lib/data/memory-reactions', '@/lib/data/memory-ops', '@/lib/kairos/predictions/create',
      '@/lib/kairos/promises/create', '@/lib/kairos/goals/transitions', '@/lib/kairos/agenda/create', '@/lib/kairos/speak', '../speak',
      '@/lib/kairos/today', '../../today']) {
      expect(FORBIDDEN_MODULES.some((re) => re.test(spec)), spec).toBe(true)
    }
    expect(FORBIDDEN_MODULES.some((re) => re.test('@/lib/kairos/dreams/read'))).toBe(false)
  })
})

// ── (b) ───────────────────────────────────────────────────────────────────

const ALLOWED_IMPORTERS: readonly RegExp[] = [
  /^lib\/kairos\/dreams\//,
  /^lib\/kairos\/daily-message\.ts$/,
  /^lib\/kairos\/thinking\/handlers\/drift-probe\.ts$/,
  /^lib\/kairos\/thinking\/queue\.ts$/,
  /^lib\/kairos\/thinking\/registry\.ts$/,
  /^lib\/kairos\/thinking\/handlers\/dream[^/]*\.ts$/,
  // Dream data readers / the echo audit (fingerprint hashing, output parse).
  /^lib\/data\/dream-[^/]*\.ts$/,
]

const NEVER_IMPORTERS: readonly RegExp[] = [
  /^lib\/kairos\/(retrieve|dialogue|chat-distill[^/]*|ask-mine[^/]*|cortex[^/]*|aether[^/]*|today[^/]*)\.ts$/,
  /^lib\/kairos\/(chat|belief)-[^/]*\.ts$/,
  /^lib\/kairos\/(ideas|beliefs)\//,
  /^lib\/kairos\/thinking\/handlers\/(chat|chat-distill|belief-[^/]*|idea-[^/]*|ask-mine|cortex|aether)\.ts$/,
  /^lib\/data\/(dialogue|belief-[^/]*|aether|kairos-today[^/]*)\.ts$/,
]

describe('(b) only the allowlisted consumers import the dreams modules', () => {
  const importers = sourceFiles(SRC).filter(importsDreams).map(rel)

  it('every importer is allowlisted', () => {
    for (const file of importers) {
      expect(ALLOWED_IMPORTERS.some((re) => re.test(file)), `${file} imports @/lib/kairos/dreams`).toBe(true)
    }
  })

  it('retrieval, dialogue, chat, belief, idea, ask-mine, cortex, aether and today never do', () => {
    for (const file of importers) {
      expect(NEVER_IMPORTERS.some((re) => re.test(file)), `${file} must not import dreams`).toBe(false)
    }
    expect(NEVER_IMPORTERS.some((re) => re.test('lib/kairos/retrieve.ts'))).toBe(true)
    expect(NEVER_IMPORTERS.some((re) => re.test('lib/kairos/ideas/judge.ts'))).toBe(true)
  })

  it('the resolver catches alias and relative imports', () => {
    const daily = path.join(SRC, 'lib/kairos/daily-message.ts')
    expect(importsDreams(daily)).toBe(true)
    expect(resolveSpecifier(daily, './dreams/line')).toBe(path.join(DREAMS_DIR, 'line'))
    expect(resolveSpecifier(daily, '@/lib/kairos/dreams/flag')).toBe(path.join(DREAMS_DIR, 'flag'))
  })
})

// ── (c) ───────────────────────────────────────────────────────────────────

const WRITER_NAME = /^(insert|create|update|upsert|delete|archive|capture|write|record|mutate|supersede|set|add|mark|close|complete)[A-Z]/

describe('(c) no dream module writes rows', () => {
  it('no direct insert / update / delete and no data-layer writer import', () => {
    for (const file of [...dreamFiles(), ...dreamDataFiles()]) {
      const src = read(file)
      expect(src, `${rel(file)} writes rows`).not.toMatch(/\b(db|tx)\s*\.\s*(insert|update|delete)\s*\(/)
      for (const m of src.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"](@\/lib\/data\/[^'"]+)['"]/g)) {
        const names = m[1].split(',').map((n) => n.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
        for (const name of names) expect(name, `${rel(file)} imports ${name} from ${m[2]}`).not.toMatch(WRITER_NAME)
      }
    }
  })
})

// ── (d) ───────────────────────────────────────────────────────────────────

const MORNING_PROMPT_PATH = [
  'lib/kairos/daily-message-inputs.ts',
  'lib/kairos/daily-message-prompt.ts',
  'lib/kairos/daily-message-tail.ts',
  'lib/kairos/daily-message-today.ts',
  'lib/kairos/thinking/handlers/daily-message.ts',
]

describe('(d) the 06:00 prompt never reads a dream; the line is Telegram-only', () => {
  it.each(MORNING_PROMPT_PATH)('%s neither imports dreams nor reads dream jobs', (file) => {
    const full = path.join(SRC, file)
    expect(importsDreams(full)).toBe(false)
    expect(read(full)).not.toMatch(/['"]dream(_read)?['"]|dreamLine|telegramTail/)
  })

  it('daily-message.ts reads the line after composing and hands it only to speak as telegramTail', () => {
    const src = read(path.join(SRC, 'lib/kairos/daily-message.ts'))
    expect(src).not.toMatch(/import\s*\{[^}]*\b(recordToday|captureMemory)\b/)
    expect(src).toMatch(/deliverKairosSpeak\(userId, input, \{ telegramTail \}\)/)
    const compose = src.slice(src.indexOf('export async function composeDailyMessage'), src.indexOf('// ── Run'))
    expect(compose.indexOf('readDreamLine')).toBeGreaterThan(compose.lastIndexOf('appendOpenQuestionsBlock'))
    expect(compose).not.toMatch(/message = `[^`]*dreamLine/)
  })

  it('only speak.ts and daily-message.ts know about telegramTail; the REST speak route keeps two arguments', () => {
    const users = sourceFiles(SRC).filter((f) => /\btelegramTail\b/.test(read(f))).map(rel).sort()
    expect(users).toEqual(['lib/kairos/daily-message.ts', 'lib/kairos/speak.ts'])
    const route = read(path.join(SRC, 'app/api/v1/kairos/speak/route.ts'))
    expect(route).toMatch(/deliverKairosSpeak\(operatorUserId, parsed\.data\)/)
  })

  it('speak.ts appends the tail only in the Telegram send', () => {
    const src = read(path.join(SRC, 'lib/kairos/speak.ts'))
    expect(src).toMatch(/sendKairosSpeak\(\{[^}]*message: tail \? `\$\{message\}\\n\\n\$\{tail\}` : message/)
    const capture = src.slice(src.indexOf('await captureMemory('), src.indexOf('let telegram'))
    expect(capture).not.toMatch(/\btail\b|telegramTail/)
  })
})
