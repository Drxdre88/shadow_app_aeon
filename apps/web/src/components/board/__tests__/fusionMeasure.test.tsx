/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { measureCard, measureFusionPlay } from '../fusionMeasure'
import type { BoardTask } from '@/lib/store/boardStore'

// The effect flies from where the cards ARE on screen. A survivor that
// cannot be seen means no effect; a source that cannot be seen starts at
// the survivor.

const task = (id: string, color = 'purple'): BoardTask => ({
  id, projectId: 'p1', name: `card ${id}`, columnId: 'col', status: 'todo', priority: 'medium', color, labels: [], onTimeline: false, orderIndex: 0,
})

function mountCard(id: string, rect: { x: number; y: number; width: number; height: number } | null) {
  const el = document.createElement('div')
  el.setAttribute('data-task-id', id)
  if (rect) {
    el.getBoundingClientRect = () => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height, x: rect.x, y: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) })
  }
  document.body.appendChild(el)
}

beforeEach(() => {
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
})
afterEach(() => { document.body.innerHTML = '' })

describe('measureCard', () => {
  it('reads the viewport rect of a rendered card and refuses a collapsed or missing one', () => {
    mountCard('a', { x: 10, y: 20, width: 200, height: 100 })
    mountCard('hidden', { x: 0, y: 0, width: 0, height: 0 })
    expect(measureCard('a')).toEqual({ x: 10, y: 20, width: 200, height: 100 })
    expect(measureCard('hidden')).toBeNull()
    expect(measureCard('nope')).toBeNull()
  })
})

describe('measureFusionPlay', () => {
  it('builds ghosts for the survivor and every source, sources without a rect starting at the survivor', () => {
    mountCard('s', { x: 500, y: 300, width: 220, height: 120 })
    mountCard('a', { x: 10, y: 20, width: 200, height: 100 })
    const play = measureFusionPlay(task('s', 'cyan'), [task('a', 'pink'), task('ghost')], 7)
    expect(play).not.toBeNull()
    expect(play!.key).toBe(7)
    expect(play!.survivor).toMatchObject({ id: 's', color: 'cyan', rect: { x: 500, y: 300 } })
    expect(play!.sources.map((g) => g.rect.x)).toEqual([10, 500])
    expect(play!.sources[1]).toMatchObject({ id: 'ghost', name: 'card ghost' })
  })

  it('is null when the survivor is not on screen', () => {
    mountCard('a', { x: 10, y: 20, width: 200, height: 100 })
    expect(measureFusionPlay(task('s'), [task('a')])).toBeNull()
  })
})
