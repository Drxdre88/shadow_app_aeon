import { describe, it, expect } from 'vitest'
import { unsafeArg } from './poller.js'

describe('unsafeArg', () => {
  it('accepts the shapes the poller actually builds', () => {
    expect(unsafeArg('model', 'claude-sonnet-5')).toBeNull()
    expect(unsafeArg('branch', 'aeon/12ab34cd')).toBeNull()
    expect(unsafeArg('branch', 'feat/ai-hangar')).toBeNull()
    expect(unsafeArg('session id', '3f2b9c1a-7d44-4e21-9a55-0c8e11d2f7a3')).toBeNull()
    expect(unsafeArg('model', 'gpt-5.6')).toBeNull()
    expect(unsafeArg('model', 'anthropic:claude-opus-5@2026')).toBeNull()
  })

  it('refuses a value that would be read as a CLI flag', () => {
    expect(unsafeArg('model', '--dangerously-skip-permissions')).not.toBeNull()
    expect(unsafeArg('model', '-p')).not.toBeNull()
    expect(unsafeArg('branch', '--upload-pack=touch /tmp/pwn')).not.toBeNull()
    expect(unsafeArg('model', '-')).not.toBeNull()
    expect(unsafeArg('branch', '.git/config')).not.toBeNull()
    expect(unsafeArg('branch', '/etc/passwd')).not.toBeNull()
  })

  it('refuses shell metacharacters and whitespace', () => {
    for (const value of ['a b', 'a&calc', 'a|b', 'a;b', 'a$(id)', 'a`id`', 'a\nb', 'a"b', "a'b", 'a>b']) {
      expect(unsafeArg('branch', value)).not.toBeNull()
    }
  })

  it('names the offending field in the refusal', () => {
    expect(unsafeArg('model', '-p')).toContain('model')
    expect(unsafeArg('branch', '-p')).toContain('branch')
  })

  it('treats an empty or missing value as nothing to check', () => {
    expect(unsafeArg('model', null)).toBeNull()
    expect(unsafeArg('model', undefined)).toBeNull()
    expect(unsafeArg('model', '')).toBeNull()
  })
})
