import type { EngineMemory } from '../types'

export const NOW = new Date('2026-10-01T01:30:00.000Z')
export const DAY_MS = 86_400_000

export function daysAgo(days: number, now: Date = NOW): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

export function makeMemory(overrides: Partial<EngineMemory> = {}): EngineMemory {
  return {
    id: 'mem-1',
    userId: 'user-1',
    dominionId: null,
    type: 'note',
    streamClass: 'idea',
    source: 'manual',
    confidence: 0.6,
    standing: null,
    pinned: false,
    createdAt: NOW,
    validAt: NOW,
    updatedAt: NOW,
    lastUsedAt: null,
    useCount: 0,
    supersededAt: null,
    invalidAt: null,
    archivedAt: null,
    sourceMetadata: {},
    links: [],
    tags: [],
    ...overrides,
  }
}
