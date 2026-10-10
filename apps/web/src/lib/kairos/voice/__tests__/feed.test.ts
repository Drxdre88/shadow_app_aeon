import { describe, expect, it } from 'vitest'
import { buildVoiceFeed, parseVoiceFeedParams, toVoiceFeedItem, type VoiceFeedRow } from '../feed'

const NOW = new Date('2026-10-10T10:00:00.000Z')
let n = 0

function row(over: Partial<VoiceFeedRow> & { meta?: Record<string, unknown> }): VoiceFeedRow {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: 'Title',
    bodyMd: 'Body text.',
    summary: null,
    type: 'inbound',
    createdAt: new Date(NOW.getTime() - 60_000 + n * 1000),
    sourceMetadata: over.meta ?? {},
    ...over,
  }
}

const needsYou = () => row({ title: 'Needs you: Swarm build waiting on approval', bodyMd: '**Swarm** is blocked [[abc]]', meta: { kind: 'morghul_finding' } })
const resolved = () => row({ title: 'Resolved: Hydra session is moving again', type: 'note', meta: { channel: 'morghul' } })
const openAsk = () => row({ title: 'Do you still want the Friday cutoff?', type: 'advisory', meta: { kairosAskStatus: 'pending', kairosAsk: { status: 'pending' } } })
const spokenQuestion = () => row({ title: 'Quick one', bodyMd: 'Did the demo land?', meta: { kairosSpeak: true, kind: 'question', urgency: 'high', status: 'pending' } })

describe('toVoiceFeedItem — what the voice line may read out', () => {
  it('includes Morghul needs-you and resolved relays', () => {
    const a = toVoiceFeedItem(needsYou(), NOW)
    const b = toVoiceFeedItem(resolved(), NOW)
    expect(a).toMatchObject({ kind: 'morghul', urgency: 'high', text: 'Swarm is blocked' })
    expect(b).toMatchObject({ kind: 'morghul', urgency: 'low' })
  })

  it('includes open asks and spoken questions', () => {
    expect(toVoiceFeedItem(openAsk(), NOW)).toMatchObject({ kind: 'question', text: 'Do you still want the Friday cutoff?' })
    expect(toVoiceFeedItem(spokenQuestion(), NOW)).toMatchObject({ kind: 'speak', urgency: 'high', text: 'Did the demo land?' })
  })

  it('excludes Morghul rollups and digests', () => {
    expect(toVoiceFeedItem(row({ title: 'Morghul hourly rollup', meta: { kind: 'morghul_finding' } }), NOW)).toBeNull()
    expect(toVoiceFeedItem(row({ title: 'Morghul daily digest', meta: { channel: 'morghul' } }), NOW)).toBeNull()
    expect(toVoiceFeedItem(row({ title: 'Needs you', meta: { channel: 'morghul', rollup: true } }), NOW)).toBeNull()
    expect(toVoiceFeedItem(row({ title: 'Needs you', meta: { kind: 'morghul_finding', findingKind: 'digest' } }), NOW)).toBeNull()
  })

  it('excludes reflections, briefs, ops alerts, notify speaks and held or expired items', () => {
    const excluded = [
      row({ type: 'reflection', title: 'Hourly reflection', meta: { kind: 'reflection' } }),
      row({ title: 'Daily brief', meta: { kairosSpeak: true, kind: 'question', digest: true } }),
      row({ title: 'Synthesis down', meta: { kairosSpeak: true, kind: 'question', opsAlert: true } }),
      row({ title: 'FYI', meta: { kairosSpeak: true, kind: 'notify' } }),
      row({ title: 'Held', meta: { kairosSpeak: true, kind: 'question', status: 'held' } }),
      row({ type: 'advisory', meta: { kairosAskStatus: 'pending', expiresAt: '2026-10-09T00:00:00.000Z' } }),
      row({ type: 'advisory', meta: { kairosAskStatus: 'answered' } }),
      row({ type: 'reflection', title: 'Needs you', meta: { channel: 'morghul' } }),
    ]
    for (const r of excluded) expect(toVoiceFeedItem(r, NOW)).toBeNull()
  })

  it('caps text at about 400 chars of plain speech', () => {
    const item = toVoiceFeedItem(row({ bodyMd: `# Head\n${'word '.repeat(300)}`, meta: { kind: 'morghul_finding' } }), NOW)
    expect(item!.text.length).toBeLessThanOrEqual(400)
    expect(item!.text).not.toContain('#')
  })
})

describe('voice feed cursor', () => {
  it('defaults since to 15 minutes ago, clamps to 24h, caps limit', () => {
    const def = parseVoiceFeedParams(new URLSearchParams(), NOW)
    expect(def.ok && def.window.since.toISOString()).toBe('2026-10-10T09:45:00.000Z')
    expect(def.ok && def.window.limit).toBe(20)
    const old = parseVoiceFeedParams(new URLSearchParams({ since: '2020-01-01T00:00:00Z', limit: '999' }), NOW)
    expect(old.ok && old.window.since.toISOString()).toBe('2026-10-09T10:00:00.000Z')
    expect(old.ok && old.window.limit).toBe(50)
    expect(parseVoiceFeedParams(new URLSearchParams({ since: 'yesterday' }), NOW).ok).toBe(false)
    expect(parseVoiceFeedParams(new URLSearchParams({ limit: '0' }), NOW).ok).toBe(false)
  })

  it('next is the last row examined, so dropped rows still advance it', () => {
    const since = new Date('2026-10-10T09:50:00.000Z')
    const rows = [needsYou(), row({ type: 'reflection' }), openAsk(), row({ title: 'digest', meta: { channel: 'morghul' } })]
    const feed = buildVoiceFeed(rows, { since, limit: 20 }, NOW)
    expect(feed.items.map((i) => i.kind)).toEqual(['morghul', 'question'])
    expect(feed.next).toBe(rows[3].createdAt.toISOString())
  })

  it('a full page stops at the last returned item; an empty page keeps since', () => {
    const since = new Date('2026-10-10T09:50:00.000Z')
    const rows = [needsYou(), openAsk(), spokenQuestion()]
    const page = buildVoiceFeed(rows, { since, limit: 2 }, NOW)
    expect(page.items).toHaveLength(2)
    expect(page.next).toBe(rows[1].createdAt.toISOString())
    expect(buildVoiceFeed([], { since, limit: 2 }, NOW).next).toBe(since.toISOString())
  })
})
