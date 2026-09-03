import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { outsideMissionNamespace, rawTail, safeStats, unsafeArg, waitForExit } from './poller.js'

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

describe('outsideMissionNamespace', () => {
  it('passes the branch names the poller generates', () => {
    expect(outsideMissionNamespace('aeon/12ab34cd')).toBeNull()
    expect(outsideMissionNamespace('aeon/9f1c2b7e')).toBeNull()
  })

  it('refuses an operator branch even though its charset is fine', () => {
    // unsafeArg only checks the charset — this is the guard that keeps a card
    // from having its mission commit to, and push, a real operator branch
    expect(unsafeArg('branch', 'feat/flight-deck')).toBeNull()
    const refusal = outsideMissionNamespace('feat/flight-deck')
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('feat/flight-deck')
    expect(refusal).toContain('mission namespace')
  })

  it('refuses the default branches and traversal shapes', () => {
    for (const branch of ['main', 'master', 'develop', 'aeon', 'aeon/', 'aeon/../feat/x', 'x/aeon/y']) {
      expect(outsideMissionNamespace(branch)).not.toBeNull()
    }
  })
})

// The tail is part of the result envelope — the one write a finished mission
// cannot afford to lose. Postgres rejects a jsonb payload holding a NUL or an
// unpaired surrogate as a non-retriable 400.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('rawTail', () => {
  it('keeps the end of the transcript within the cap', () => {
    const tail = rawTail(`${'x'.repeat(5000)}END`)
    expect(tail.length).toBeLessThanOrEqual(2000)
    expect(tail.endsWith('END')).toBe(true)
  })

  it('returns short output unchanged', () => {
    expect(rawTail('all done\n')).toBe('all done\n')
    expect(rawTail('')).toBe('')
  })

  it('strips a NUL byte that would 400 the whole envelope', () => {
    expect(rawTail('done\u0000ok')).toBe('doneok')
    expect(rawTail(`${'x'.repeat(3000)}\u0000tail`)).not.toContain('\u0000')
  })

  it('never opens on half of a surrogate pair', () => {
    // the pair straddles the 2000-char boundary: a blind slice(-2000) starts
    // on the low half and leaves it unpaired
    const stdout = `${'A'.repeat(5)}\uD83D\uDE80${'B'.repeat(1999)}`
    const blind = stdout.slice(-2000)
    expect(LONE_SURROGATE.test(blind)).toBe(true)

    const tail = rawTail(stdout)
    expect(LONE_SURROGATE.test(tail)).toBe(false)
    expect(tail.length).toBeLessThanOrEqual(2000)
    expect(tail.endsWith('B')).toBe(true)
  })

  it('replaces a surrogate that was already lone in the engine output', () => {
    const tail = rawTail('start \uD800 end')
    expect(LONE_SURROGATE.test(tail)).toBe(false)
    expect(tail).toContain('start')
    expect(tail).toContain('end')
  })
})

describe('waitForExit', () => {
  it('resolves at once when there is no live child', async () => {
    expect(await waitForExit(null)).toBe(true)
  })

  it('waits for a child to actually close before teardown continues', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 150)'])
    expect(await waitForExit(child, 10_000)).toBe(true)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('gives up on a wedged child instead of holding the mission slot', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    try {
      expect(await waitForExit(child, 150)).toBe(false)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('resolves immediately for a child that already exited', async () => {
    const child = spawn(process.execPath, ['-e', ''])
    await new Promise((done) => child.once('close', done))
    expect(await waitForExit(child, 150)).toBe(true)
  })
})

describe('safeStats', () => {
  it('reports the mission without telemetry rather than losing the envelope', () => {
    const thrower = {
      feed: () => ({ events: [], raw: '' }),
      flush: () => ({ events: [], raw: '' }),
      stats: () => { throw new Error('stats exploded') },
    }
    expect(safeStats(thrower)).toBeNull()
    expect(safeStats(null)).toBeNull()
  })

  it('passes real telemetry straight through', () => {
    const parser = {
      feed: () => ({ events: [], raw: '' }),
      flush: () => ({ events: [], raw: '' }),
      stats: () => ({ toolCalls: 7, inputTokens: 12 }),
    }
    expect(safeStats(parser)).toEqual({ toolCalls: 7, inputTokens: 12 })
  })
})
