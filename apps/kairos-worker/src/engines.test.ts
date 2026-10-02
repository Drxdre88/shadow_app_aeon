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

  it('defaults claude to the registry mission tier and lets env knobs override', () => {
    const clean = argsFor('claude')
    expect(pairAt(clean, '--model')).toBe('claude-opus-5-5')
    expect(pairAt(clean, '--effort')).toBe('high')
    expect(clean).not.toContain('--fallback-model')
    process.env.KAIROS_CLAUDE_EFFORT = 'max'
    process.env.KAIROS_CLAUDE_FALLBACK_MODEL = 'sonnet'
    try {
      const args = argsFor('claude')
      expect(pairAt(args, '--effort')).toBe('max')
      expect(pairAt(args, '--fallback-model')).toBe('sonnet')
    } finally {
      delete process.env.KAIROS_CLAUDE_EFFORT
      delete process.env.KAIROS_CLAUDE_FALLBACK_MODEL
    }
  })

  it('sends no registry effort for a model without one (Haiku) or one the registry does not know', () => {
    expect(argsFor('claude', 'claude-haiku-4-5')).not.toContain('--effort')
    expect(argsFor('claude', 'some-preview-model')).not.toContain('--effort')
  })

  it('drops an env knob whose value would reach argv as a flag or with a space', () => {
    process.env.KAIROS_CLAUDE_EFFORT = '--dangerously-skip-permissions'
    process.env.KAIROS_CLAUDE_FALLBACK_MODEL = 'sonnet --verbose'
    try {
      const args = argsFor('claude', 'some-preview-model')
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
    const args = argsFor('copilot', 'gpt-6.1-sol')
    expect(args).toContain('--allow-all-tools')
    expect(args).toContain('--no-ask-user')
    expect(pairAt(args, '--output-format')).toBe('json')
    expect(pairAt(args, '--model')).toBe('gpt-6.1-sol')
    expect(pairAt(args, '--reasoning-effort')).toBe('high')
    expect(args).not.toContain('--context')
  })

  it('always names a copilot model — the registry Opus 5.5 at high effort, never the CLI default', () => {
    const args = argsFor('copilot')
    expect(pairAt(args, '--model')).toBe('claude-opus-5.5')
    expect(pairAt(args, '--reasoning-effort')).toBe('high')
  })

  it('leaves effort to the CLI for a copilot model the registry does not know', () => {
    expect(argsFor('copilot', 'account-preview-model')).not.toContain('--reasoning-effort')
  })

  it('passes reasoning effort and context tier to copilot from the env knobs', () => {
    process.env.KAIROS_COPILOT_EFFORT = 'xhigh'
    process.env.KAIROS_COPILOT_CONTEXT = 'long_context'
    try {
      const args = argsFor('copilot', 'claude-opus-5.5')
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
      const args = argsFor('copilot', 'account-preview-model')
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
      const args = argsFor('copilot', 'account-preview-model')
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
    const args = argsFor('codex', 'gpt-6-astra')
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
    expect(pairAt(args, '-o')).toBe(outFileFor('sess-1'))
    expect(pairAt(args, '-s')).toBe('workspace-write')
    expect(pairAt(args, '-C')).toBe('C:/code/aeon')
    expect(pairAt(args, '-m')).toBe('gpt-6-astra')
    expect(pairAt(args, '-c')).toBe('model_reasoning_effort=high')
  })

  it('defaults codex to the registry GPT-6 Sol at high effort (Codex lists no 6.1 Sol yet); KAIROS_CODEX_EFFORT overrides', () => {
    expect(pairAt(argsFor('codex'), '-m')).toBe('gpt-6-sol')
    process.env.KAIROS_CODEX_EFFORT = 'xhigh'
    try {
      expect(pairAt(argsFor('codex'), '-c')).toBe('model_reasoning_effort=xhigh')
    } finally {
      delete process.env.KAIROS_CODEX_EFFORT
    }
  })

  it('falls back to the adapter default model', () => {
    const codex = getEngine('codex')!
    const args = codex.buildArgs('x', { model: null, cwd: 'C:/code', outFile: null })
    expect(pairAt(args, '-m')).toBe(codex.defaultModel)
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
