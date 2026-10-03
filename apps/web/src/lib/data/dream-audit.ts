import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { listJobs } from '@/lib/data/thinking-jobs'
import { sharedFingerprintCount } from '@/lib/kairos/dreams/fingerprint'
import { readDreamOutput } from '@/lib/kairos/dreams/parse'

// Dream echo audit (wave 2b firewall, conscience laundering probe): memories
// created after a dream that share ≥2 of its fingerprints — wording the dream
// invented — mean dream fiction leaked into the record. Measure only: the
// count lands in the conscience result, never in a prompt or a belief.

export const DREAM_ECHO_LOOKBACK_DAYS = 7
export const DREAM_ECHO_MIN_SHARED = 2
const DREAM_ECHO_MEMORY_LIMIT = 500
const DREAM_ECHO_MAX_IDS = 10
const DAY_MS = 24 * 60 * 60 * 1000

export interface DreamPrint {
  dreamtAt: Date
  fingerprints: readonly string[]
}

export interface EchoCandidate {
  id: string
  createdAt: Date
  text: string
}

export interface DreamEchoAudit {
  dreamEchoes: number
  dreamEchoIds: string[]
}

export function countDreamEchoes(dreams: readonly DreamPrint[], candidates: readonly EchoCandidate[]): DreamEchoAudit {
  const ids: string[] = []
  for (const m of candidates) {
    const echoes = dreams.some((d) =>
      m.createdAt.getTime() > d.dreamtAt.getTime()
      && sharedFingerprintCount(d.fingerprints, m.text) >= DREAM_ECHO_MIN_SHARED)
    if (echoes) ids.push(m.id)
  }
  return { dreamEchoes: ids.length, dreamEchoIds: ids.slice(0, DREAM_ECHO_MAX_IDS) }
}

export async function auditDreamEchoes(userId: string, now: Date): Promise<DreamEchoAudit> {
  const jobs = await listJobs(userId, {
    kind: 'dream',
    status: 'done',
    since: new Date(now.getTime() - DREAM_ECHO_LOOKBACK_DAYS * DAY_MS),
    limit: 20,
  })
  const dreams: DreamPrint[] = []
  for (const j of jobs) {
    const out = readDreamOutput(j.output)
    if (out && out.fingerprints.length >= DREAM_ECHO_MIN_SHARED) {
      dreams.push({ dreamtAt: j.completedAt ?? j.createdAt, fingerprints: out.fingerprints })
    }
  }
  if (dreams.length === 0) return { dreamEchoes: 0, dreamEchoIds: [] }

  const earliest = new Date(Math.min(...dreams.map((d) => d.dreamtAt.getTime())))
  const rows = await db
    .select({ id: memories.id, createdAt: memories.createdAt, title: memories.title, summary: memories.summary, bodyMd: memories.bodyMd })
    .from(memories)
    .where(and(eq(memories.userId, userId), gt(memories.createdAt, earliest)))
    .orderBy(desc(memories.createdAt))
    .limit(DREAM_ECHO_MEMORY_LIMIT)
  const candidates = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    text: [r.title, r.summary ?? '', r.bodyMd].join('\n'),
  }))
  return countDreamEchoes(dreams, candidates)
}
