import { describe, it, expect } from 'vitest'
import {
  collectText,
  decideFinalStatus,
  extractEnvelope,
  normalizeEnvelope,
  STATUS_ALIASES,
} from './envelope.js'

const REAL = '```json\n{"status":"completed","outcome":"shipped","summary":"done"}\n```'
const TEMPLATE =
  '```json\n{"status":"completed|needs_input|failed","outcome":"...","summary":"...","artifacts":[]}\n```'

describe('normalizeEnvelope', () => {
  it('maps every alias to its canonical status', () => {
    for (const [alias, canonical] of Object.entries(STATUS_ALIASES)) {
      expect(normalizeEnvelope({ status: alias })).toEqual({ status: canonical })
    }
  })

  it('canonicalizes case and whitespace before the alias lookup', () => {
    expect(normalizeEnvelope({ status: 'Completed' })).toEqual({ status: 'completed' })
    expect(normalizeEnvelope({ status: ' COMPLETE ' })).toEqual({ status: 'completed' })
    expect(normalizeEnvelope({ status: '  Needs_Input' })).toEqual({ status: 'needs_input' })
    expect(normalizeEnvelope({ status: 'FAILURE' })).toEqual({ status: 'failed' })
  })

  it('returns the same object when the status is already canonical', () => {
    const envelope = { status: 'needs_input', questions: ['which repo?'] }
    expect(normalizeEnvelope(envelope)).toBe(envelope)
  })

  it('passes unknown statuses through untouched so Aeon can reject them', () => {
    const envelope = { status: 'partially_done' }
    expect(normalizeEnvelope(envelope)).toBe(envelope)
    expect(normalizeEnvelope({ status: 'completed|needs_input|failed' }))
      .toEqual({ status: 'completed|needs_input|failed' })
  })

  it('does not treat inherited object members as aliases', () => {
    expect(normalizeEnvelope({ status: '__proto__' })).toEqual({ status: '__proto__' })
    expect(normalizeEnvelope({ status: 'constructor' })).toEqual({ status: 'constructor' })
    expect(normalizeEnvelope({ status: 'toString' })).toEqual({ status: 'toString' })
  })

  it('leaves envelopes without a string status alone', () => {
    expect(normalizeEnvelope(null)).toBeNull()
    expect(normalizeEnvelope({ outcome: 'blocked' })).toEqual({ outcome: 'blocked' })
    expect(normalizeEnvelope({ status: 3 })).toEqual({ status: 3 })
  })

  it('keeps the rest of the envelope intact while rewriting the status', () => {
    expect(normalizeEnvelope({ status: 'done', summary: 'x', artifacts: ['a'] }))
      .toEqual({ status: 'completed', summary: 'x', artifacts: ['a'] })
  })
})

describe('extractEnvelope', () => {
  it('returns the last parseable block when several are real envelopes', () => {
    const text = `${REAL}\nmore prose\n\`\`\`json\n{"status":"failed","summary":"second"}\n\`\`\``
    expect(extractEnvelope(text)).toEqual({ status: 'failed', summary: 'second' })
  })

  it('ignores the fenced template when it precedes the real envelope', () => {
    expect(extractEnvelope(`${TEMPLATE}\nworking...\n${REAL}`))
      .toEqual({ status: 'completed', outcome: 'shipped', summary: 'done' })
  })

  it('ignores the fenced template when the engine echoes it after the real envelope', () => {
    expect(extractEnvelope(`${REAL}\nAs instructed the shape was:\n${TEMPLATE}`))
      .toEqual({ status: 'completed', outcome: 'shipped', summary: 'done' })
  })

  it('prefers an aliased status over a later template', () => {
    const aliased = '```json\n{"status":"complete","summary":"copilot"}\n```'
    expect(extractEnvelope(`${aliased}\n${TEMPLATE}`)).toEqual({ status: 'complete', summary: 'copilot' })
  })

  it('falls back to the last parseable block when nothing looks like an envelope', () => {
    expect(extractEnvelope(`\`\`\`json\n{"a":1}\n\`\`\`\n${TEMPLATE}`))
      .toEqual({ status: 'completed|needs_input|failed', outcome: '...', summary: '...', artifacts: [] })
  })

  it('skips unparseable and non-object blocks', () => {
    const text = `\`\`\`json\n{"status":"failed","summary":"real"}\n\`\`\`\n\`\`\`json\n[1,2]\n\`\`\`\n\`\`\`json\nnot json\n\`\`\``
    expect(extractEnvelope(text)).toEqual({ status: 'failed', summary: 'real' })
  })

  it('returns null when there is no fenced json at all', () => {
    expect(extractEnvelope('the agent just talked')).toBeNull()
  })
})

describe('collectText', () => {
  it('appends text decoded out of a stream-json transcript', () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"' +
        '```json\\n{\\"status\\":\\"completed\\",\\"summary\\":\\"streamed\\"}\\n```"}]}}',
    ].join('\n')
    expect(extractEnvelope(collectText(raw))).toEqual({ status: 'completed', summary: 'streamed' })
  })

  it('leaves plain stdout untouched', () => {
    expect(collectText('hello\nworld')).toBe('hello\nworld')
  })

  // codex writes JSONL to its -o file, so the file path has to run the same
  // decode as stdout or the envelope stays escaped inside a "text" field.
  it('recovers an envelope from a JSONL out-file body', () => {
    const jsonl = [
      '{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}',
      'plain progress line the CLI printed alongside the stream',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Shipped it.\\n\\n' +
        '```json\\n{\\"status\\":\\"completed\\",\\"summary\\":\\"from jsonl\\"}\\n```"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10}}',
    ].join('\n')

    expect(extractEnvelope(jsonl)).toBeNull()
    expect(extractEnvelope(collectText(jsonl))).toEqual({ status: 'completed', summary: 'from jsonl' })
  })

  it('recovers an envelope from a plain (non-JSONL) out-file body', () => {
    const plain = `the agent wrote prose here\n${REAL}\n`
    expect(extractEnvelope(collectText(plain))).toEqual({
      status: 'completed',
      outcome: 'shipped',
      summary: 'done',
    })
  })
})

describe('decideFinalStatus', () => {
  it('reports killed above everything else', () => {
    expect(decideFinalStatus('completed', true, false)).toBe('killed')
    expect(decideFinalStatus('completed', true, true)).toBe('killed')
  })

  it('reports succeeded for completed and needs_input', () => {
    expect(decideFinalStatus('completed', false, false)).toBe('succeeded')
    expect(decideFinalStatus('needs_input', false, false)).toBe('succeeded')
  })

  it('reports failed for a missing or unrecognized status', () => {
    expect(decideFinalStatus(null, false, false)).toBe('failed')
    expect(decideFinalStatus('failed', false, false)).toBe('failed')
    expect(decideFinalStatus('partially_done', false, false)).toBe('failed')
  })

  it('never shows green when Aeon refused the envelope', () => {
    expect(decideFinalStatus('completed', false, true)).toBe('failed')
    expect(decideFinalStatus('needs_input', false, true)).toBe('failed')
  })
})
