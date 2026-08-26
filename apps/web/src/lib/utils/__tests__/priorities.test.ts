import { describe, it, expect } from 'vitest'
import { INITIAL_PRIORITIES, type CustomPriority } from '@aeon/shared'
import { resolvePriority, priorityBadgeStyle, priorityActiveStyle } from '../priorities'

// Locks the single-source-of-truth rule: priority appearance comes from the
// user's customized set (themeStore.priorities), never from factory constants
// duplicated in components.
describe('resolvePriority', () => {
  const customized: CustomPriority[] = [
    { id: 'low', name: 'chill 🧊', color: '#00ff00' },
    { id: 'medium', name: 'steady', color: '#123456' },
    { id: 'high', name: 'hot 🔥', color: '#ff00ff' },
    { id: 'urgent', name: 'NOW', color: '#ff0000' },
    { id: 'vip', name: 'VIP ⭐', color: '#ffd700' },
  ]

  it('returns the customized appearance, not the factory one', () => {
    const resolved = resolvePriority(customized, 'high')
    expect(resolved.name).toBe('hot 🔥')
    expect(resolved.color).toBe('#ff00ff')
    const factory = INITIAL_PRIORITIES.find((p) => p.id === 'high')!
    expect(resolved.color).not.toBe(factory.color)
  })

  it('resolves user-added custom priority levels', () => {
    const resolved = resolvePriority(customized, 'vip')
    expect(resolved).toEqual({ id: 'vip', name: 'VIP ⭐', color: '#ffd700' })
  })

  it('keeps custom emoji names intact', () => {
    expect(resolvePriority(customized, 'low').name).toBe('chill 🧊')
  })

  it('falls back to the factory definition only when the id is missing from the customized set', () => {
    const withoutUrgent = customized.filter((p) => p.id !== 'urgent')
    const resolved = resolvePriority(withoutUrgent, 'urgent')
    const factory = INITIAL_PRIORITIES.find((p) => p.id === 'urgent')!
    expect(resolved.color).toBe(factory.color)
    expect(resolved.name).toBe(factory.name)
  })

  it('returns a neutral fallback for a completely unknown id', () => {
    const resolved = resolvePriority(customized, 'ghost')
    expect(resolved.id).toBe('ghost')
    expect(resolved.name).toBe('ghost')
    expect(resolved.color).toBe('#94a3b8')
  })

  it('resolves every factory id when handed the default set', () => {
    for (const p of INITIAL_PRIORITIES) {
      expect(resolvePriority([...INITIAL_PRIORITIES], p.id)).toEqual(p)
    }
  })
})

describe('priority styles', () => {
  it('badge style derives both background and text from the custom color', () => {
    const style = priorityBadgeStyle('#ff0000')
    expect(style.color).toBe('#ff0000')
    expect(style.backgroundColor).toBe('rgba(255, 0, 0, 0.15)')
  })

  it('active style derives all channels from the custom color', () => {
    const style = priorityActiveStyle('#00ff00')
    expect(style.color).toBe('#00ff00')
    expect(style.backgroundColor).toBe('rgba(0, 255, 0, 0.25)')
    expect(style.borderColor).toBe('rgba(0, 255, 0, 0.5)')
    expect(style.boxShadow).toContain('rgba(0, 255, 0, 0.35)')
  })
})
