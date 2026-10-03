import { describe, expect, it } from 'vitest'
import { assignDistortions, DREAM_DISTORTIONS } from '../distort'
import { dreamFingerprints, MAX_FINGERPRINTS, sharedFingerprintCount, shingleHashes } from '../fingerprint'
import { buildDreamOutput, parseDreamText, readDreamOutput, type DreamJobContext } from '../parse'

const ctx: DreamJobContext = {
  date: '2026-10-03',
  memories: [
    { alias: 'm1', id: 'mem-1', dominionId: 'A', bucket: '0-7d', distortion: 'swap_who' },
    { alias: 'm2', id: 'mem-2', dominionId: 'B', bucket: '7-30d', distortion: 'flip_outcome' },
  ],
  seeds: [{ alias: 's1', kind: 'ask', ref: 'ask-1' }],
}

const good = {
  title: 'The desk that floated',
  scenes: [
    { ref: 'm1', distortion: 'swap_who', text: 'My brother signs the hedging plan instead of me.' },
    { ref: 'm2', distortion: 'flip_outcome', text: 'The launch succeeds and everyone is disappointed.' },
  ],
  dream: 'I walk through a trading floor that is also a beach, and my brother signs the plan while the tide counts down.',
  seedEcho: 'It circles the open question about the go-live.',
}
const answer = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...good, ...patch })

describe('dream strict parse', () => {
  it('accepts a well-formed answer', () => {
    expect(parseDreamText(answer(), ctx).scenes).toHaveLength(2)
  })

  it.each([
    ['unknown ref', { scenes: [{ ...good.scenes[0], ref: 'm9' }, good.scenes[1]] }],
    ['wrong distortion', { scenes: [{ ...good.scenes[0], distortion: 'flip_outcome' }, good.scenes[1]] }],
    ['unknown distortion', { scenes: [{ ...good.scenes[0], distortion: 'melt' }, good.scenes[1]] }],
    ['duplicate memory', { scenes: [good.scenes[0], good.scenes[0]] }],
    ['one memory only', { scenes: [good.scenes[0]] }],
    ['extra key', { mood: 'calm' }],
    ['title too long', { title: 'x'.repeat(81) }],
    ['scene too long', { scenes: [{ ...good.scenes[0], text: 'x'.repeat(351) }, good.scenes[1]] }],
    ['dream too long', { dream: 'x'.repeat(1201) }],
    ['seedEcho too long', { seedEcho: 'x'.repeat(161) }],
    ['missing dream', { dream: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseDreamText(answer(patch), ctx)).toThrow(/^dream:/)
  })

  it('rejects non-JSON', () => {
    expect(() => parseDreamText('I had a dream', ctx)).toThrow()
  })
})

describe('dream output', () => {
  it('is fiction-marked, maps aliases to ids and round-trips through readDreamOutput', () => {
    const out = buildDreamOutput(parseDreamText(answer(), ctx), ctx, [])
    expect(out).toMatchObject({ dreamt: true, v: 1, date: '2026-10-03', title: good.title, dream: good.dream, seeds: ctx.seeds })
    expect(out.scenes).toEqual([
      { memoryId: 'mem-1', distortion: 'swap_who', text: good.scenes[0].text },
      { memoryId: 'mem-2', distortion: 'flip_outcome', text: good.scenes[1].text },
    ])
    expect(Object.keys(out).sort()).toEqual(['date', 'dream', 'dreamt', 'fingerprints', 'scenes', 'seeds', 'title', 'v'])
    expect(readDreamOutput(out)).toEqual(out)
    expect(readDreamOutput({ ...out, dreamt: false })).toBeNull()
  })
})

describe('dream fingerprints', () => {
  const source = 'the quick brown fox jumps over the lazy dog near the river bank'
  const dream = 'The quick brown fox jumps over the lazy dog near the river bank, then a violet whale sings about invoices to a sleeping moon.'

  it('excludes shingles found in the source text', () => {
    const fps = dreamFingerprints([dream], [source])
    const sourceSet = new Set(shingleHashes(source))
    expect(fps.length).toBeGreaterThan(0)
    for (const f of fps) expect(sourceSet.has(f)).toBe(false)
    expect(dreamFingerprints([source], [source])).toEqual([])
  })

  it('is case and punctuation insensitive and detects echoes', () => {
    const fps = dreamFingerprints([dream], [source])
    expect(sharedFingerprintCount(fps, 'then a VIOLET whale sings about invoices, to a sleeping moon!')).toBeGreaterThanOrEqual(2)
    expect(sharedFingerprintCount(fps, source)).toBe(0)
  })

  it('caps at 64, spread across the dream', () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
    const fps = dreamFingerprints([long], [])
    expect(fps).toHaveLength(MAX_FINGERPRINTS)
    expect(fps[0]).toBe(shingleHashes(long)[0])
  })

  it('build output excludes the prompt the model saw', () => {
    const out = buildDreamOutput(parseDreamText(answer(), ctx), ctx, [`Summary: ${good.dream}`])
    expect(out.fingerprints.every((f) => !shingleHashes(good.dream).includes(f))).toBe(true)
  })
})

describe('dream distortions', () => {
  it('rotates from a date-hashed offset, deterministically', () => {
    const a = assignDistortions('2026-10-03', 5)
    expect(assignDistortions('2026-10-03', 5)).toEqual(a)
    const start = DREAM_DISTORTIONS.indexOf(a[0])
    expect(a).toEqual([0, 1, 2, 3, 4].map((i) => DREAM_DISTORTIONS[(start + i) % 4]))
    const starts = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((d) => assignDistortions(d, 1)[0]))
    expect(starts.size).toBeGreaterThan(1)
  })
})
