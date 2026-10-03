/**
 * Horae is owner-cancelled and server-booked only.
 *
 * - Nothing under the MCP transport, the REST v1 surface or the thinking
 *   queue may import the cancel path, the raw agenda writer, the owner server
 *   action or the Telegram command router. (fire / create are the thinking
 *   side's only way in; REST/MCP read through listKairosAgenda.)
 * - The agenda_due handler imports only an allowlist: no board writer, no
 *   memory-update writer, no goal or promise transition.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(p, 'utf8')

const FORBIDDEN_ROOTS = ['app/api/[transport]', 'app/api/v1', 'lib/kairos/thinking']
const FORBIDDEN_IDENTIFIERS = /\b(cancelAgendaItem|cancelOwnKairosAgendaItem|mutateKairosAgenda|routeAgendaCommands)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(agenda\/(cancel|telegram-commands)|actions\/kairos-agenda)['"]/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

function importStatements(src: string): string[] {
  return src.match(/import[\s\S]*?from\s+['"][^'"]+['"]/g) ?? []
}

describe('Horae writers are unreachable from agent surfaces', () => {
  it.each(FORBIDDEN_ROOTS)('nothing under %s imports a cancel / mutate path', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const stmt of importStatements(read(file))) {
        const rel = path.relative(SRC, file)
        expect(stmt, `${rel} imports an agenda writer`).not.toMatch(FORBIDDEN_IDENTIFIERS)
        expect(stmt, `${rel} imports an agenda writer module`).not.toMatch(FORBIDDEN_MODULES)
      }
    }
  })

  it('the REST route is GET-only and reads through the data layer', () => {
    const src = read(path.join(SRC, 'app/api/v1/kairos/agenda/route.ts'))
    expect(src).toMatch(/export const GET\b/)
    expect(src).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
    expect(src).toMatch(/import \{[^}]*\blistKairosAgenda\b[^}]*\} from '@\/lib\/data\/kairos-agenda'/)
  })

  it('the MCP tool is one read-only list tool', () => {
    const src = read(path.join(SRC, 'app/api/[transport]/tools/kairos-agenda.ts'))
    expect([...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])).toEqual(['list_kairos_agenda'])
    expect(src).toMatch(/readOnlyHint: true/)
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { cancelAgendaItem } from '@/lib/kairos/agenda/cancel'"
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_MODULES)
  })
})

// Exactly what the agenda_due handler may import. Anything new here must be
// a reader or one of the three allowed writers (captureMemory,
// createKairosAskMemory, deliverKairosSpeak) — never a board / memory-update
// / goal / promise writer.
const HANDLER_ALLOWED: Record<string, readonly string[]> = {
  zod: ['z'],
  '@/lib/data/ask': ['createKairosAskMemory', 'listOpenKairosAsks'],
  '@/lib/data/goals': ['findGoal'],
  '@/lib/data/memories': ['captureMemory', 'findMemoriesByIds'],
  '@/lib/data/validators/kairos-agenda': ['AgendaResult', 'KairosAgendaItem'],
  '@/lib/kairos/agenda/create': ['createAgendaItems'],
  '@/lib/kairos/agenda/fire': ['AGENDA_DUE_KIND', 'agendaDueJobKey', 'markAgendaMissed', 'planAgendaDue', 'readFiredAgendaItem', 'settleAgendaItem'],
  '@/lib/kairos/agenda/flag': ['agendaEnabled'],
  '@/lib/kairos/agenda/prompt': ['AGENDA_DUE_MAX_OUTPUT_TOKENS', 'AGENDA_DUE_SYSTEM_PROMPT', 'buildAgendaDuePrompt', 'parseAgendaDueText', 'AgendaDueOutput', 'AgendaPromptBasis', 'AgendaPromptGoal'],
  '@/lib/kairos/agenda/rules': ['AGENDA_DUE_DEADLINE_MINUTES'],
  '@/lib/kairos/ask-mine': ['ASK_BACKLOG_MAX'],
  '@/lib/kairos/speak': ['deliverKairosSpeak'],
  '@/lib/kairos/engine/types': ['ApplyOutcome', 'ThinkingAnsweredBy', 'ThinkingJobHandler', 'ThinkingJobKind', 'ThinkingJobRow', 'ThinkingJobSpec'],
  './_errors': ['errorReason'],
}

describe('agenda_due handler imports', () => {
  it('imports only the allowlisted readers and writers', () => {
    const src = read(path.join(SRC, 'lib/kairos/thinking/handlers/agenda-due.ts'))
    for (const stmt of importStatements(src)) {
      const mod = stmt.match(/from\s+['"]([^'"]+)['"]/)![1]!
      const names = (stmt.match(/\{([\s\S]*?)\}/)?.[1] ?? '')
        .split(',')
        .map((n) => n.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean)
      expect(HANDLER_ALLOWED[mod], `unexpected module ${mod}`).toBeDefined()
      for (const name of names) expect(HANDLER_ALLOWED[mod], `${name} from ${mod}`).toContain(name)
    }
  })

  it('imports no board, memory-update, goal or promise writer by name', () => {
    const src = read(path.join(SRC, 'lib/kairos/thinking/handlers/agenda-due.ts'))
    expect(importStatements(src).join('\n')).not.toMatch(/\b(updateMemory|archiveMemory|mutateMemory|createBoardTask|updateBoardTask|moveTask|closeGoal|approveGoal|closeKairosPromise|mutateKairosPromises)\b|lib\/data\/(tasks|board|columns)/)
  })
})
