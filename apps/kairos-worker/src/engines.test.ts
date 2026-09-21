import { describe, it, expect } from 'vitest'
import { engineIds, getEngine, outFileFor } from './engines.js'

function argsFor(id: string, model: string | null = null): string[] {
  const engine = getEngine(id)
  if (!engine) throw new Error(`missing engine ${id}`)
  return engine.buildArgs('do the mission', { model, cwd: 'C:/code/aeon', outFile: outFileFor('sess-1') })
}

function pairAt(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}

describe('getEngine', () => {
  it('resolves the three supported engines', () => {
    expect(engineIds().sort()).toEqual(['claude', 'codex', 'copilot'])
    for (const id of engineIds()) expect(getEngine(id)?.id).toBe(id)
  })

  it('refuses unknown ids and inherited object members', () => {
    expect(getEngine('gemini')).toBeNull()
    expect(getEngine('constructor')).toBeNull()
    expect(getEngine('toString')).toBeNull()
    expect(getEngine('__proto__')).toBeNull()
  })
})

describe('buildArgs', () => {
  it('passes --verbose with stream-json — the CLI hard-requires it in print mode', () => {
    const args = argsFor('claude')
    expect(pairAt(args, '--output-format')).toBe('stream-json')
    expect(args).toContain('--verbose')
    expect(pairAt(args, '-p')).toBe('do the mission')
    expect(pairAt(args, '--permission-mode')).toBe('acceptEdits')
  })

  it('passes effort and fallback-model to claude only when the env knobs are set', () => {
    const clean = argsFor('claude')
    expect(clean).not.toContain('--effort')
    expect(clean).not.toContain('--fallback-model')
    process.env.KAIROS_CLAUDE_EFFORT = 'high'
    process.env.KAIROS_CLAUDE_FALLBACK_MODEL = 'sonnet'
    try {
      const args = argsFor('claude')
      expect(pairAt(args, '--effort')).toBe('high')
      expect(pairAt(args, '--fallback-model')).toBe('sonnet')
    } finally {
      delete process.env.KAIROS_CLAUDE_EFFORT
      delete process.env.KAIROS_CLAUDE_FALLBACK_MODEL
    }
  })

  it('drops an env knob whose value would reach argv as a flag or with a space', () => {
    process.env.KAIROS_CLAUDE_EFFORT = '--dangerously-skip-permissions'
    process.env.KAIROS_CLAUDE_FALLBACK_MODEL = 'sonnet --verbose'
    try {
      const args = argsFor('claude')
      expect(args).not.toContain('--effort')
      expect(args).not.toContain('--fallback-model')
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(args).not.toContain('sonnet --verbose')
    } finally {
      delete process.env.KAIROS_CLAUDE_EFFORT
      delete process.env.KAIROS_CLAUDE_FALLBACK_MODEL
    }
  })

  it('runs copilot unattended with json output', () => {
    const args = argsFor('copilot', 'claude-sonnet-5')
    expect(args).toContain('--allow-all-tools')
    expect(args).toContain('--no-ask-user')
    expect(pairAt(args, '--output-format')).toBe('json')
    expect(pairAt(args, '--model')).toBe('claude-sonnet-5')
    expect(args).not.toContain('--reasoning-effort')
    expect(args).not.toContain('--context')
  })

  it('passes reasoning effort and context tier to copilot only when the env knobs are set', () => {
    process.env.KAIROS_COPILOT_EFFORT = 'xhigh'
    process.env.KAIROS_COPILOT_CONTEXT = 'long_context'
    try {
      const args = argsFor('copilot', 'claude-opus-5')
      expect(pairAt(args, '--reasoning-effort')).toBe('xhigh')
      expect(pairAt(args, '--context')).toBe('long_context')
    } finally {
      delete process.env.KAIROS_COPILOT_EFFORT
      delete process.env.KAIROS_COPILOT_CONTEXT
    }
  })

  it('drops a copilot knob that would reach argv as a flag', () => {
    process.env.KAIROS_COPILOT_EFFORT = '--allow-all-paths'
    process.env.KAIROS_COPILOT_CONTEXT = 'long_context --yolo'
    try {
      const args = argsFor('copilot', 'claude-opus-5')
      expect(args).not.toContain('--reasoning-effort')
      expect(args).not.toContain('--context')
      expect(args).not.toContain('--allow-all-paths')
      expect(args).not.toContain('--yolo')
    } finally {
      delete process.env.KAIROS_COPILOT_EFFORT
      delete process.env.KAIROS_COPILOT_CONTEXT
    }
  })

  it('drops safe-looking copilot values outside the supported enums', () => {
    process.env.KAIROS_COPILOT_EFFORT = 'ultra'
    process.env.KAIROS_COPILOT_CONTEXT = 'long-context'
    try {
      const args = argsFor('copilot', 'claude-opus-5')
      expect(args).not.toContain('--reasoning-effort')
      expect(args).not.toContain('--context')
      expect(args).not.toContain('ultra')
      expect(args).not.toContain('long-context')
    } finally {
      delete process.env.KAIROS_COPILOT_EFFORT
      delete process.env.KAIROS_COPILOT_CONTEXT
    }
  })

  it('sends codex its result to a file with -o', () => {
    const args = argsFor('codex', 'gpt-5.6')
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
    expect(pairAt(args, '-o')).toBe(outFileFor('sess-1'))
    expect(pairAt(args, '-s')).toBe('workspace-write')
    expect(pairAt(args, '-C')).toBe('C:/code/aeon')
    expect(pairAt(args, '-m')).toBe('gpt-5.6')
  })

  it('falls back to the adapter default and omits the flag when there is none', () => {
    const codex = getEngine('codex')!
    const args = codex.buildArgs('x', { model: null, cwd: 'C:/code', outFile: null })
    if (codex.defaultModel === null) expect(args).not.toContain('-m')
    else expect(pairAt(args, '-m')).toBe(codex.defaultModel)
    expect(args).not.toContain('-o')
  })

  it('reads the envelope from stdout for the CLI engines and from a file for codex', () => {
    expect(getEngine('claude')?.envelopeSource).toBe('stdout')
    expect(getEngine('copilot')?.envelopeSource).toBe('stdout')
    expect(getEngine('codex')?.envelopeSource).toBe('file')
  })

  // Ten production missions ran on copilot and every attempt was recorded with
  // an unknown observed model: the adapter had no parser, so nothing read the
  // identity the CLI printed in its own event stream.
  it('gives copilot a parser that captures the model the CLI reports', () => {
    const parser = getEngine('copilot')?.streamParser?.()
    expect(parser, 'copilot adapter has no streamParser').toBeDefined()

    const line = JSON.stringify({
      type: 'session.start',
      data: { sessionId: 's1', copilotVersion: '1.0.83', selectedModel: 'claude-sonnet-5' },
    })
    parser!.feed(`${line}\n`)

    expect(parser!.stats().model).toBe('claude-sonnet-5')
  })
})
