import { describe, it, expect, afterEach } from 'vitest'
import { resolve, sep } from 'node:path'
import { quoteForCmd, resolveRepoPath } from './spawner.js'

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
