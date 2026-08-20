// Engine adapters for poll mode (AI Hangar). One shape per CLI: which binary
// to shell, which argv turns a dispatch prompt into an unattended run, and
// where the terminal result envelope can be read from afterwards.
//
// Flags verified against the CLIs installed on the runner host (2026-08-20):
//   claude  v2.1.237  — stream-json in --print mode HARD-REQUIRES --verbose
//   copilot v1.0.70   — -p/--allow-all-tools/--no-ask-user/--output-format/--model
//   codex   0.144.1   — exec --json -o <file> -s <mode> -C <dir> -m <model>
//
// Push mode does NOT use this module: its argv stays in spawner.ts untouched.

import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type EngineId = 'claude' | 'copilot' | 'codex'

export interface BuildArgsOptions {
  model?: string | null
  cwd: string
  outFile?: string | null
}

export interface EngineAdapter {
  id: EngineId
  bin: string
  buildArgs(prompt: string, opts: BuildArgsOptions): string[]
  // Where the fenced-json envelope is recovered from once the CLI exits.
  envelopeSource: 'stdout' | 'file'
  defaultModel: string | null
}

function modelArgs(flag: string, model: string | null | undefined, fallback: string | null): string[] {
  const chosen = model ?? fallback
  return chosen ? [flag, chosen] : []
}

const claude: EngineAdapter = {
  id: 'claude',
  bin: process.env.KAIROS_CLAUDE_BIN ?? 'claude',
  buildArgs(prompt, opts) {
    return [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      ...modelArgs('--model', opts.model, this.defaultModel),
    ]
  },
  envelopeSource: 'stdout',
  defaultModel: process.env.KAIROS_CLAUDE_DEFAULT_MODEL ?? null,
}

const copilot: EngineAdapter = {
  id: 'copilot',
  bin: process.env.KAIROS_COPILOT_BIN ?? 'copilot',
  buildArgs(prompt, opts) {
    return [
      '-p', prompt,
      '--allow-all-tools',
      '--no-ask-user',
      '--output-format', 'json',
      ...modelArgs('--model', opts.model, this.defaultModel),
    ]
  },
  envelopeSource: 'stdout',
  // Copilot's picker slug for Opus 5 must be confirmed on the POC host — see README.
  defaultModel: process.env.KAIROS_COPILOT_DEFAULT_MODEL ?? 'claude-opus-5',
}

const codex: EngineAdapter = {
  id: 'codex',
  bin: process.env.KAIROS_CODEX_BIN ?? 'codex',
  buildArgs(prompt, opts) {
    return [
      'exec', prompt,
      '--json',
      ...(opts.outFile ? ['-o', opts.outFile] : []),
      '-s', 'workspace-write',
      '-C', opts.cwd,
      ...modelArgs('-m', opts.model, this.defaultModel),
    ]
  },
  envelopeSource: 'file',
  defaultModel: process.env.KAIROS_CODEX_DEFAULT_MODEL ?? null,
}

const adapters: Record<EngineId, EngineAdapter> = { claude, copilot, codex }

export function getEngine(id: string): EngineAdapter | null {
  return adapters[id as EngineId] ?? null
}

export function engineIds(): EngineId[] {
  return Object.keys(adapters) as EngineId[]
}

export function outFileFor(sessionId: string): string {
  return join(tmpdir(), `aeon-hangar-${sessionId}.txt`)
}
