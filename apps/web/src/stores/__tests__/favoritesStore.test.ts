import { describe, it, expect, beforeEach } from 'vitest'
import { useFavoritesStore, deriveFavoritesList, type FavoriteEntry } from '@/stores/favoritesStore'

const entry = (id: string, name: string, favoritedAt: number): FavoriteEntry => ({ id, name, favoritedAt })

beforeEach(() => {
  useFavoritesStore.setState({ entries: null })
})

describe('deriveFavoritesList', () => {
  it('returns [] when the store has not been hydrated (null entries)', () => {
    expect(deriveFavoritesList(null, [])).toEqual([])
  })

  it('returns [] when there are no favorites', () => {
    expect(deriveFavoritesList([], [])).toEqual([])
  })

  it('orders by favoritedAt ascending (oldest star first)', () => {
    const list = deriveFavoritesList(
      [entry('c', 'Gamma', 300), entry('a', 'Alpha', 100), entry('b', 'Beta', 200)],
      [],
    )
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks favoritedAt ties by name', () => {
    const list = deriveFavoritesList(
      [entry('z', 'Zulu', 100), entry('a', 'Alpha', 100), entry('m', 'Mike', 100)],
      [],
    )
    expect(list.map((e) => e.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  it('filters out sidebar-hidden projects', () => {
    const list = deriveFavoritesList(
      [entry('a', 'Alpha', 100), entry('b', 'Beta', 200), entry('c', 'Gamma', 300)],
      ['b'],
    )
    expect(list.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('returns [] when every favorite is hidden (section hides entirely)', () => {
    expect(deriveFavoritesList([entry('a', 'Alpha', 100)], ['a'])).toEqual([])
  })

  it('does not mutate the input entries array', () => {
    const input = [entry('b', 'Beta', 200), entry('a', 'Alpha', 100)]
    deriveFavoritesList(input, [])
    expect(input.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('favoritesStore applyToggle (live toggle updates)', () => {
  it('is a no-op before hydration so a lone toggle never fakes a full list', () => {
    useFavoritesStore.getState().applyToggle('a', true, { name: 'Alpha' })
    expect(useFavoritesStore.getState().entries).toBeNull()
  })

  it('adds a favorite after hydration and it shows up in the derived list', () => {
    useFavoritesStore.getState().setEntries([entry('a', 'Alpha', 100)])
    useFavoritesStore.getState().applyToggle('b', true, { name: 'Beta', favoritedAt: 200 })
    const list = deriveFavoritesList(useFavoritesStore.getState().entries, [])
    expect(list.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('new stars append at the end of the derived order', () => {
    useFavoritesStore.getState().setEntries([entry('a', 'Alpha', 100), entry('b', 'Beta', 200)])
    useFavoritesStore.getState().applyToggle('c', true, { name: 'Aardvark', favoritedAt: 300 })
    const list = deriveFavoritesList(useFavoritesStore.getState().entries, [])
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('removes a favorite and the derived list drops it', () => {
    useFavoritesStore.getState().setEntries([entry('a', 'Alpha', 100), entry('b', 'Beta', 200)])
    useFavoritesStore.getState().applyToggle('a', false)
    const list = deriveFavoritesList(useFavoritesStore.getState().entries, [])
    expect(list.map((e) => e.id)).toEqual(['b'])
  })

  it('ignores a duplicate add (star toggled twice fast)', () => {
    useFavoritesStore.getState().setEntries([entry('a', 'Alpha', 100)])
    useFavoritesStore.getState().applyToggle('a', true, { name: 'Alpha', favoritedAt: 999 })
    expect(useFavoritesStore.getState().entries).toEqual([entry('a', 'Alpha', 100)])
  })

  it('ignores an add without name info (hydrate will pick it up)', () => {
    useFavoritesStore.getState().setEntries([])
    useFavoritesStore.getState().applyToggle('a', true)
    expect(useFavoritesStore.getState().entries).toEqual([])
  })

  it('ignores a remove for an id not in the list', () => {
    const initial = [entry('a', 'Alpha', 100)]
    useFavoritesStore.getState().setEntries(initial)
    useFavoritesStore.getState().applyToggle('zzz', false)
    expect(useFavoritesStore.getState().entries).toBe(initial)
  })

  it('round-trips a rollback: add then remove restores the original list', () => {
    useFavoritesStore.getState().setEntries([entry('a', 'Alpha', 100)])
    useFavoritesStore.getState().applyToggle('b', true, { name: 'Beta' })
    useFavoritesStore.getState().applyToggle('b', false)
    expect(useFavoritesStore.getState().entries).toEqual([entry('a', 'Alpha', 100)])
  })
})
