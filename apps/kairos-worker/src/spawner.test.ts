import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { quoteForCmd, resolveRepoPath, runEngine } from './spawner.js'
import { postEvent, postEventsBatch } from './callback.js'
import type { CallbackContext } from './callback.js'
import type { StreamParser } from './stream-parser.js'

// Nothing leaves the machine, and the write path becomes observable: which
// posts went out as paced batches and which as one-off events is exactly what
// the 60 writes/min budget turns on.
vi.mock('./callback.js', () => ({
  postEvent: vi.fn(async () => ({ ok: true, status: 200, data: null })),
  postEventsBatch: vi.fn(async () => undefined),
  patchSession: vi.fn(async () => ({ ok: true, status: 200, data: null })),
}))

// One cmd.exe parsing pass. '^' escapes the next character (and the escaped
// character never toggles quote state); inside quotes the command separators
// are inert. Returns what the next parser downstream receives plus any
// separator that would have split the command line at this stage — that list
// being non-empty is the CVE-2024-24576 shape.
function cmdPass(line: string): { text: string; separators: string[] } {
  let text = ''
  const separators: string[] = []
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (!quoted && ch === '^') {
      i++
      if (i < line.length) text += line[i]
      continue
    }
    if (ch === '"') {
      quoted = !quoted
      text += ch
      continue
    }
    if (!quoted && '&|<>'.includes(ch)) separators.push(ch)
    text += ch
  }

  return { text, separators }
}

// The MSVCRT rules the child applies to whatever survives the cmd passes.
function crtUnquote(text: string): string {
  let out = ''
  let slashes = 0
  for (const ch of text) {
    if (ch === '\\') {
      slashes++
      continue
    }
    if (ch === '"') {
      out += '\\'.repeat(Math.floor(slashes / 2))
      if (slashes % 2 === 1) out += '"'
      slashes = 0
      continue
    }
    out += '\\'.repeat(slashes) + ch
    slashes = 0
  }
  return out + '\\'.repeat(slashes)
}

function roundTrip(arg: string, shim: boolean): { value: string; separators: string[] } {
  const separators: string[] = []
  let line = quoteForCmd(arg, shim)
  for (let pass = 0; pass < (shim ? 2 : 1); pass++) {
    const result = cmdPass(line)
    separators.push(...result.separators)
    line = result.text
  }
  return { value: crtUnquote(line), separators }
}

const INJECTIONS = ['a" & calc & "b', 'a|b', '%PATH%', 'x\\"y', 'a^b', '(x)']

describe('quoteForCmd', () => {
  it('leaves an ordinary argument on the fast path', () => {
    expect(quoteForCmd('claude-sonnet-5', true)).toBe('claude-sonnet-5')
    expect(quoteForCmd('claude-sonnet-5', false)).toBe('claude-sonnet-5')
    expect(quoteForCmd('C:/Users/dev/repo', true)).toBe('C:/Users/dev/repo')
    expect(quoteForCmd('aeon/12ab34cd', true)).toBe('aeon/12ab34cd')
  })

  it('escapes anything off the fast path', () => {
    for (const payload of INJECTIONS) {
      expect(quoteForCmd(payload, true)).not.toBe(payload)
    }
  })

  it.each(INJECTIONS)('carries %j through the shim path with no active separator', (payload) => {
    const { value, separators } = roundTrip(payload, true)
    expect(separators).toEqual([])
    expect(value).toBe(payload)
  })

  it.each(INJECTIONS)('carries %j through the single cmd pass with no active separator', (payload) => {
    const { value, separators } = roundTrip(payload, false)
    expect(separators).toEqual([])
    expect(value).toBe(payload)
  })

  it('keeps a brief pointer with a redirect and a pipe inert', () => {
    const payload = 'Read C:/tmp/brief.md > out.txt | more & del *'
    const { value, separators } = roundTrip(payload, true)
    expect(separators).toEqual([])
    expect(value).toBe(payload)
  })

  it('does not leave a bare separator anywhere in the shim output', () => {
    expect(cmdPass(quoteForCmd('a" & calc & "b', true)).separators).toEqual([])
  })
})

describe('resolveRepoPath', () => {
  const ROOT = resolve(sep === '\\' ? 'C:\\code\\roots' : '/code/roots')
  const originalRoot = process.env.KAIROS_WORKER_REPO_ROOT

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.KAIROS_WORKER_REPO_ROOT
    else process.env.KAIROS_WORKER_REPO_ROOT = originalRoot
  })

  function underRoot(repo: string | null): string {
    process.env.KAIROS_WORKER_REPO_ROOT = ROOT
    return resolveRepoPath(repo)
  }

  it('resolves a plain slug to a directory under the root', () => {
    expect(underRoot('aeon')).toBe(resolve(ROOT, 'aeon'))
    expect(underRoot('nested/aeon')).toBe(resolve(ROOT, 'nested/aeon'))
    expect(underRoot('./aeon')).toBe(resolve(ROOT, 'aeon'))
  })

  it('falls back to the root itself when no repo is given', () => {
    expect(underRoot(null)).toBe(ROOT)
    expect(underRoot('.')).toBe(ROOT)
  })

  it('refuses a repo that climbs out of the root', () => {
    for (const escape of ['..', '../..', '../sibling', '../../Windows/System32', 'aeon/../../escape']) {
      expect(() => underRoot(escape)).toThrow(/outside the worker repo root/)
    }
  })

  it('refuses an absolute path outside the root', () => {
    const absolute = sep === '\\' ? 'C:/Windows/System32' : '/etc'
    expect(() => underRoot(absolute)).toThrow(/outside the worker repo root/)
  })

  it('refuses a sibling whose name merely shares the root prefix', () => {
    expect(() => underRoot(`${ROOT}-evil`)).toThrow(/outside the worker repo root/)
  })

  it('names the offending repo in the refusal', () => {
    expect(() => underRoot('../escape')).toThrow(/repo "\.\.\/escape"/)
  })

  it('reads the root fresh on every call', () => {
    process.env.KAIROS_WORKER_REPO_ROOT = ROOT
    expect(resolveRepoPath('aeon')).toBe(resolve(ROOT, 'aeon'))
    const moved = resolve(ROOT, 'elsewhere')
    process.env.KAIROS_WORKER_REPO_ROOT = moved
    expect(resolveRepoPath('aeon')).toBe(resolve(moved, 'aeon'))
  })
})

// A parser throw used to be an uncaught exception on the stdout 'data'
// handler: that kills the runner process and orphans every concurrent
// mission. Events go to a dead port so nothing leaves the machine.
describe('runEngine parser isolation', () => {
  const ctx: CallbackContext = {
    sessionId: 'parser-throw-test',
    callbackBaseUrl: 'http://127.0.0.1:1',
    callbackToken: 'unused',
  }

  function throwingParser(): StreamParser {
    return {
      feed: () => { throw new Error('parser exploded on engine json') },
      flush: () => { throw new Error('parser exploded on flush') },
      stats: () => ({ toolCalls: 0 }),
    }
  }

  it('keeps the runner alive and falls back to raw when the parser throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handle = runEngine({
        sessionId: ctx.sessionId,
        ctx,
        bin: process.execPath,
        args: ['-e', 'process.stdout.write("engine said hello\\n")'],
        cwd: process.cwd(),
        capture: true,
        parser: throwingParser(),
      })

      const code = await new Promise<number | null>((done) => handle.child.once('close', done))
      expect(code).toBe(0)
      // stdout is still captured, so the result envelope is still readable
      expect(handle.captured()).toContain('engine said hello')

      const logged = errors.mock.calls.map((call) => String(call[0]))
      expect(logged.some((line) => line.includes('stream parser feed threw'))).toBe(true)
      expect(logged.some((line) => line.includes('stream parser flush threw'))).toBe(true)
    } finally {
      errors.mockRestore()
    }
  })

  it('logs a repeatedly throwing parser at most three times', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const handle = runEngine({
        sessionId: 'parser-throw-rate-limit',
        ctx: { ...ctx, sessionId: 'parser-throw-rate-limit' },
        bin: process.execPath,
        args: ['-e', 'for (let i = 0; i < 40; i++) process.stdout.write(`line ${i}\\n`)'],
        cwd: process.cwd(),
        capture: true,
        parser: throwingParser(),
      })

      await new Promise((done) => handle.child.once('close', done))
      const feedLogs = errors.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('stream parser'))
      expect(feedLogs.length).toBeLessThanOrEqual(3)
      expect(feedLogs.length).toBeGreaterThan(0)
    } finally {
      errors.mockRestore()
    }
  })
})


// 100KB of degraded output used to leave emit() posting one event per 8000
// chars, outside the pacing floor — ~13 simultaneous writes against the same
// budget the terminal result post depends on.
describe('runEngine raw output batching', () => {
  const ctx: CallbackContext = {
    sessionId: 'raw-batching',
    callbackBaseUrl: 'http://127.0.0.1:1',
    callbackToken: 'unused',
  }

  beforeEach(() => {
    vi.mocked(postEvent).mockClear()
    vi.mocked(postEventsBatch).mockClear()
  })

  function batchedText(): string {
    return vi.mocked(postEventsBatch).mock.calls
      .flatMap((call) => call[1])
      .filter((event) => event.kind === 'message')
      .map((event) => String((event.payload as { text?: unknown } | undefined)?.text ?? ''))
      .join('')
  }

  function looseMessagePosts(): number {
    return vi.mocked(postEvent).mock.calls.filter((call) => call[1].kind === 'message').length
  }

  async function runWithOutput(sessionId: string, bytes: number): Promise<void> {
    const handle = runEngine({
      sessionId,
      ctx: { ...ctx, sessionId },
      bin: process.execPath,
      args: ['-e', `process.stdout.write('x'.repeat(${bytes}))`],
      cwd: process.cwd(),
      capture: true,
      batchStdout: true,
    })
    await new Promise((done) => handle.child.once('close', done))
  }

  it('routes raw stdout through the paced batch path, not one write per chunk', async () => {
    await runWithOutput('raw-batching', 100_000)

    expect(batchedText().length).toBe(100_000)
    expect(looseMessagePosts()).toBe(0)
    // a handful of paced batches instead of ~13 unpaced single writes
    expect(vi.mocked(postEventsBatch).mock.calls.length).toBeGreaterThan(0)
    expect(vi.mocked(postEventsBatch).mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('keeps every byte when the raw buffer passes its cap', async () => {
    await runWithOutput('raw-batching-cap', 1_050_000)

    expect(batchedText().length).toBe(1_050_000)
    expect(looseMessagePosts()).toBe(0)
  })

  it('assigns each batched raw chunk its own sequence number', async () => {
    await runWithOutput('raw-batching-seq', 40_000)

    const seqs = vi.mocked(postEventsBatch).mock.calls.flatMap((call) => call[1]).map((event) => event.seq)
    expect(seqs.length).toBeGreaterThan(1)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs]).toEqual([...seqs].sort((a, b) => a - b))
  })
})
