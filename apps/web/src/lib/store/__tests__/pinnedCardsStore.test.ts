/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  usePinnedCardsStore,
  isCardPinned,
  clampPosition,
  cascadePosition,
  CASCADE_BASE_X,
  CASCADE_BASE_Y,
  CASCADE_STEP,
  DEFAULT_CARD_WIDTH,
  MIN_VISIBLE,
} from '../pinnedCardsStore'

const store = () => usePinnedCardsStore.getState()

beforeEach(() => {
  usePinnedCardsStore.setState({ cards: [], nextZ: 1 })
})

describe('openCard', () => {
  it('adds a floating card with a cascade position and stacking order', () => {
    store().openCard('a')
    const [card] = store().cards
    expect(card).toMatchObject({
      taskId: 'a',
      folded: false,
      width: DEFAULT_CARD_WIDTH,
      z: 1,
    })
    expect(card.x).toBe(CASCADE_BASE_X)
    expect(card.y).toBe(CASCADE_BASE_Y)
  })

  it('cascades multiple cards diagonally with increasing z', () => {
    store().openCard('a')
    store().openCard('b')
    store().openCard('c')
    const cards = store().cards
    expect(cards).toHaveLength(3)
    expect(cards[1].x).toBe(CASCADE_BASE_X + CASCADE_STEP)
    expect(cards[1].y).toBe(CASCADE_BASE_Y + CASCADE_STEP)
    expect(cards[2].x).toBe(CASCADE_BASE_X + 2 * CASCADE_STEP)
    expect(cards.map((c) => c.z)).toEqual([1, 2, 3])
  })

  it('re-opening an already pinned card unfolds it and brings it to front instead of duplicating', () => {
    store().openCard('a')
    store().openCard('b')
    store().setFolded('a', true)
    store().openCard('a')
    const cards = store().cards
    expect(cards).toHaveLength(2)
    const a = cards.find((c) => c.taskId === 'a')!
    const b = cards.find((c) => c.taskId === 'b')!
    expect(a.folded).toBe(false)
    expect(a.z).toBeGreaterThan(b.z)
  })

  it('honors an explicit position, clamped to the viewport', () => {
    store().openCard('a', { x: 99999, y: -50 })
    const [card] = store().cards
    expect(card.x).toBe(window.innerWidth - MIN_VISIBLE)
    expect(card.y).toBe(0)
  })
})

describe('closeCard / closeAll', () => {
  it('removes only the closed card', () => {
    store().openCard('a')
    store().openCard('b')
    store().closeCard('a')
    expect(store().cards.map((c) => c.taskId)).toEqual(['b'])
    expect(isCardPinned('a')).toBe(false)
    expect(isCardPinned('b')).toBe(true)
  })

  it('closeAll empties the layer', () => {
    store().openCard('a')
    store().openCard('b')
    store().closeAll()
    expect(store().cards).toEqual([])
  })
})

describe('fold / unfold', () => {
  it('folds a card away and restores it', () => {
    store().openCard('a')
    store().setFolded('a', true)
    expect(store().cards[0].folded).toBe(true)
    store().setFolded('a', false)
    expect(store().cards[0].folded).toBe(false)
  })

  it('restoring from the dock brings the card to the front', () => {
    store().openCard('a')
    store().openCard('b')
    store().setFolded('a', true)
    store().setFolded('a', false)
    const a = store().cards.find((c) => c.taskId === 'a')!
    const b = store().cards.find((c) => c.taskId === 'b')!
    expect(a.z).toBeGreaterThan(b.z)
  })

  it('ignores unknown task ids', () => {
    store().openCard('a')
    const before = store().cards
    store().setFolded('nope', true)
    expect(store().cards).toBe(before)
  })
})

describe('z-ordering', () => {
  it('bringToFront raises a card above the others', () => {
    store().openCard('a')
    store().openCard('b')
    store().openCard('c')
    store().bringToFront('a')
    const cards = store().cards
    const a = cards.find((c) => c.taskId === 'a')!
    expect(cards.every((c) => c.taskId === 'a' || c.z < a.z)).toBe(true)
  })

  it('is a no-op when the card is already on top (no z churn)', () => {
    store().openCard('a')
    store().openCard('b')
    const zBefore = store().nextZ
    store().bringToFront('b')
    expect(store().nextZ).toBe(zBefore)
  })
})

describe('setPosition', () => {
  it('moves a card and clamps it inside the viewport', () => {
    store().openCard('a')
    store().setPosition('a', 10, 20)
    expect(store().cards[0]).toMatchObject({ x: 10, y: 20 })

    store().setPosition('a', -99999, 99999)
    const card = store().cards[0]
    expect(card.x).toBe(MIN_VISIBLE - card.width)
    expect(card.y).toBe(window.innerHeight - MIN_VISIBLE)
  })
})

describe('pure helpers', () => {
  it('clampPosition keeps the title bar reachable on every edge', () => {
    const w = 480
    expect(clampPosition(-10000, -10000, w, 1280, 800)).toEqual({ x: MIN_VISIBLE - w, y: 0 })
    expect(clampPosition(10000, 10000, w, 1280, 800)).toEqual({
      x: 1280 - MIN_VISIBLE,
      y: 800 - MIN_VISIBLE,
    })
  })

  it('cascadePosition wraps after 8 slots', () => {
    const p0 = cascadePosition(0, 1280, 800)
    const p8 = cascadePosition(8, 1280, 800)
    expect(p8).toEqual(p0)
  })

  it('cascadePosition never escapes a tiny viewport', () => {
    for (let i = 0; i < 12; i++) {
      const { x, y } = cascadePosition(i, 320, 240)
      expect(x).toBeLessThanOrEqual(320 - MIN_VISIBLE)
      expect(y).toBeLessThanOrEqual(240 - MIN_VISIBLE)
      expect(y).toBeGreaterThanOrEqual(0)
    }
  })
})
