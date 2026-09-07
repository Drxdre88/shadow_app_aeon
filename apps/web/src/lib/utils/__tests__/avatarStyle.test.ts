import { describe, it, expect } from 'vitest'
import { hasAvatarOverride, avatarShapeClass, memberAvatarStyle, normaliseShape } from '../avatarStyle'

describe('hasAvatarOverride', () => {
  it('an unstyled member has none, so their photo keeps winning', () => {
    expect(hasAvatarOverride(undefined)).toBe(false)
    expect(hasAvatarOverride({})).toBe(false)
    expect(hasAvatarOverride({ initials: null, color: null, textColor: null, shape: null })).toBe(false)
    expect(hasAvatarOverride({ initials: '  ' })).toBe(false)
  })

  it('any single override counts — the whole point is that styling replaces the photo', () => {
    expect(hasAvatarOverride({ initials: 'AS' })).toBe(true)
    expect(hasAvatarOverride({ color: '#ff0000' })).toBe(true)
    expect(hasAvatarOverride({ textColor: 'blue' })).toBe(true)
    expect(hasAvatarOverride({ shape: 'square' })).toBe(true)
  })
})

describe('shape', () => {
  it('unknown or missing shapes fall back to a circle rather than an unstyled box', () => {
    expect(normaliseShape(null)).toBe('circle')
    expect(normaliseShape('hexagon')).toBe('circle')
    expect(avatarShapeClass(undefined)).toBe('rounded-full')
    expect(avatarShapeClass('square')).toBe('rounded-none')
    expect(avatarShapeClass('rounded')).not.toBe('rounded-full')
  })
})

describe('memberAvatarStyle', () => {
  it('derives a deterministic fill from the seed when nothing is set', () => {
    const a = memberAvatarStyle({ seed: 'Andrey Selikhov' })
    const b = memberAvatarStyle({ seed: 'Andrey Selikhov' })
    expect(a.style.background).toBe(b.style.background)
    expect(String(a.style.background)).toContain('hsl(')
    expect(a.style.color).toBeUndefined()
    expect(a.className).toBe('rounded-full')
  })

  it('a raw hex fill and a text colour land as inline CSS', () => {
    const s = memberAvatarStyle({ seed: 'x', color: '#112233', textColor: '#ffeeaa', shape: 'square' })
    expect(String(s.style.background)).toContain('#112233')
    expect(s.style.color).toBe('#ffeeaa')
    expect(s.className).toBe('rounded-none')
  })

  it('accent names resolve to their preset hex', () => {
    const s = memberAvatarStyle({ seed: 'x', color: 'purple' })
    expect(String(s.style.background)).toMatch(/#[0-9a-f]{6}/i)
  })

  it('dim keeps the flat translucent pile look for an unstyled member', () => {
    const s = memberAvatarStyle({ seed: 'x' }, { dim: true })
    expect(s.style.background).toBe('rgba(255,255,255,0.08)')
    const styled = memberAvatarStyle({ seed: 'x', color: 'blue' }, { dim: true })
    expect(String(styled.style.background)).toContain('linear-gradient')
  })
})
