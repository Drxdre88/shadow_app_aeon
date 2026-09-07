import { describe, it, expect } from 'vitest'
import { parseAvatarPrefs, DEFAULT_AVATAR_PREFS, effectiveAvatarPrefs } from '../sizing'
import { parseRealmAvatarPrefs } from '@/lib/utils/avatarPrefs'
import { updateMemberProfileSchema } from '@/lib/data/validators'

describe('parseAvatarPrefs', () => {
  it('defaults to photos winning, so an untouched board is unchanged', () => {
    expect(parseAvatarPrefs(undefined)).toEqual(DEFAULT_AVATAR_PREFS)
    expect(parseAvatarPrefs(null)).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({})).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({ sizing: { unit: 'days' } })).toEqual({ preferInitials: false })
  })

  it('only an exact true turns it on — a truthy string must not', () => {
    expect(parseAvatarPrefs({ avatars: { preferInitials: true } })).toEqual({ preferInitials: true })
    expect(parseAvatarPrefs({ avatars: { preferInitials: 'yes' } })).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({ avatars: { preferInitials: 1 } })).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({ avatars: { preferInitials: false } })).toEqual({ preferInitials: false })
  })

  it('survives a malformed settings blob rather than throwing on a board load', () => {
    expect(parseAvatarPrefs({ avatars: 'nonsense' })).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({ avatars: null })).toEqual({ preferInitials: false })
    expect(parseAvatarPrefs({ avatars: [] })).toEqual({ preferInitials: false })
  })
})

describe('updateMemberProfileSchema', () => {
  it('keeps null distinct from absent — null clears, absent leaves alone', () => {
    expect(updateMemberProfileSchema.parse({ initials: null })).toEqual({ initials: null })
    const parsed = updateMemberProfileSchema.parse({ initials: 'AR' })
    expect(parsed.initials).toBe('AR')
    expect(parsed.color).toBeUndefined()
    expect(parsed.displayName).toBeUndefined()
  })

  it('rejects a patch that says nothing', () => {
    expect(() => updateMemberProfileSchema.parse({})).toThrow()
  })

  it('rejects an empty string, which would render a blank avatar', () => {
    expect(() => updateMemberProfileSchema.parse({ initials: '' })).toThrow()
    expect(() => updateMemberProfileSchema.parse({ initials: '   ' })).toThrow()
    expect(() => updateMemberProfileSchema.parse({ displayName: '' })).toThrow()
  })

  it('holds initials to the varchar(4) the column allows', () => {
    expect(updateMemberProfileSchema.parse({ initials: 'ABCD' }).initials).toBe('ABCD')
    expect(() => updateMemberProfileSchema.parse({ initials: 'ABCDE' })).toThrow()
  })

  it('trims, so a stray space cannot smuggle past the length cap', () => {
    expect(updateMemberProfileSchema.parse({ initials: '  AR  ' }).initials).toBe('AR')
    expect(updateMemberProfileSchema.parse({ displayName: ' Ada Lovelace ' }).displayName).toBe('Ada Lovelace')
  })
})

describe('updateMemberProfileSchema — styling wave 2', () => {
  it('accepts a raw hex or a preset name for fill and text, nothing else', () => {
    expect(updateMemberProfileSchema.parse({ color: '#1A2b3C' }).color).toBe('#1A2b3C')
    expect(updateMemberProfileSchema.parse({ textColor: 'blue' }).textColor).toBe('blue')
    expect(() => updateMemberProfileSchema.parse({ color: 'red; background: url(x)' })).toThrow()
    expect(() => updateMemberProfileSchema.parse({ textColor: '#fff' })).toThrow()
    expect(() => updateMemberProfileSchema.parse({ color: 'rgb(1,2,3)' })).toThrow()
    expect(() => updateMemberProfileSchema.parse({ color: 'mauve' })).toThrow()
  })

  it('shape is a closed vocabulary, and null clears it', () => {
    expect(updateMemberProfileSchema.parse({ shape: 'square' }).shape).toBe('square')
    expect(updateMemberProfileSchema.parse({ shape: null }).shape).toBeNull()
    expect(() => updateMemberProfileSchema.parse({ shape: 'hexagon' })).toThrow()
  })

  it('a shape-only or text-only patch is a real update', () => {
    expect(() => updateMemberProfileSchema.parse({ shape: 'rounded' })).not.toThrow()
    expect(() => updateMemberProfileSchema.parse({ textColor: null })).not.toThrow()
  })
})

describe('effectiveAvatarPrefs', () => {
  it('the realm policy ORs with the project pref — either one hides photos', () => {
    expect(effectiveAvatarPrefs({ avatarPrefs: { preferInitials: false }, realmPreferInitials: false })).toEqual({ preferInitials: false })
    expect(effectiveAvatarPrefs({ avatarPrefs: { preferInitials: true }, realmPreferInitials: false })).toEqual({ preferInitials: true })
    expect(effectiveAvatarPrefs({ avatarPrefs: { preferInitials: false }, realmPreferInitials: true })).toEqual({ preferInitials: true })
  })
})

describe('parseRealmAvatarPrefs', () => {
  it('reads workspace_groups.settings.avatars.preferInitials and only an exact true', () => {
    expect(parseRealmAvatarPrefs(undefined)).toEqual({ preferInitials: false })
    expect(parseRealmAvatarPrefs({})).toEqual({ preferInitials: false })
    expect(parseRealmAvatarPrefs({ avatars: { preferInitials: true } })).toEqual({ preferInitials: true })
    expect(parseRealmAvatarPrefs({ avatars: { preferInitials: 'yes' } })).toEqual({ preferInitials: false })
    expect(parseRealmAvatarPrefs({ avatars: [] })).toEqual({ preferInitials: false })
    expect(parseRealmAvatarPrefs({ consolidated: true })).toEqual({ preferInitials: false })
  })
})
