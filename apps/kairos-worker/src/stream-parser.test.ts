// Fixtures mirror a live capture of `claude -p --output-format stream-json
// --verbose` (CLI v2.1.x, 2026-08-21) — the contract this parser is built on.

import { describe, expect, it } from 'vitest'
import { createClaudeStreamParser, type TypedEvent } from './stream-parser.js'

const INIT_LINE = JSON.stringify({
  type: 'system', subtype: 'init', cwd: 'C:\\repo', session_id: 's1',
  model: 'claude-sonnet-5', permissionMode: 'acceptEdits',
  claude_code_version: '2.1.237', tools: ['Bash', 'Read', 'Edit'],
})

function assistantLine(block: Record<string, unknown>, requestId = 'req_1', extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    request_id: requestId,
    message: {
      content: [block],
      usage: {
        input_tokens: 10, output_tokens: 3,
        cache_read_input_tokens: 19646, cache_creation_input_tokens: 11652,
      },
    },
    ...extra,
  })
}

const TOOL_USE_LINE = assistantLine({
  type: 'tool_use', id: 'toolu_01', name: 'Bash',
  input: { command: 'echo hello-flight-deck', description: 'Echo test' },
})

const TOOL_RESULT_LINE = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01', is_error: false, content: 'hello-flight-deck' }] },
})

const RESULT_LINE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false,
  duration_ms: 9152, duration_api_ms: 3158, num_turns: 2, total_cost_usd: 0.0296784,
  usage: {
    input_tokens: 18, output_tokens: 176,
    cache_read_input_tokens: 50944, cache_creation_input_tokens: 11843,
    output_tokens_details: { thinking_tokens: 86 },
  },
})

function feedAll(lines: string[]): { events: TypedEvent[]; raw: string } {
  const parser = createClaudeStreamParser()
  const events: TypedEvent[] = []
  let raw = ''
  for (const line of lines) {
    const out = parser.feed(`${line}\n`)
    events.push(...out.events)
    raw += out.raw
  }
  const tail = parser.flush()
  events.push(...tail.events)
  raw += tail.raw
  return { events, raw }
}

describe('claude stream parser', () => {
  it('maps an init line to a system event with the config snapshot', () => {
    const { events } = feedAll([INIT_LINE])
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('system')
    expect(events[0].payload).toMatchObject({
      subtype: 'init', model: 'claude-sonnet-5', permissionMode: 'acceptEdits',
      version: '2.1.237', toolCount: 3,
    })
  })

  it('maps a tool_use block to a tool_use event with name, id and input summary', () => {
    const { events } = feedAll([TOOL_USE_LINE])
    const tool = events.find((e) => e.kind === 'tool_use')
    expect(tool).toBeDefined()
    expect(tool!.toolName).toBe('Bash')
    expect(tool!.payload.toolUseId).toBe('toolu_01')
    expect(tool!.payload.input).toContain('echo hello-flight-deck')
  })

  it('correlates a tool_result back to the tool name via tool_use_id', () => {
    const { events } = feedAll([TOOL_USE_LINE, TOOL_RESULT_LINE])
    const result = events.find((e) => e.kind === 'tool_result')
    expect(result).toBeDefined()
    expect(result!.toolName).toBe('Bash')
    expect(result!.payload).toMatchObject({ toolUseId: 'toolu_01', isError: false, content: 'hello-flight-deck' })
  })

  it('maps thinking and text blocks to thinking/message events', () => {
    const { events } = feedAll([
      assistantLine({ type: 'thinking', thinking: 'plan the echo', signature: 'sig' }),
      assistantLine({ type: 'text', text: 'done' }),
    ])
    expect(events.find((e) => e.kind === 'thinking')?.payload.text).toBe('plan the echo')
    expect(events.find((e) => e.kind === 'message')?.payload).toMatchObject({ stream: 'assistant', text: 'done' })
  })

  it('emits ONE usage event per request_id — repeated snapshots collapse, last wins', () => {
    const { events } = feedAll([
      assistantLine({ type: 'thinking', thinking: 'a', signature: 's' }, 'req_1'),
      assistantLine({ type: 'text', text: 'b' }, 'req_1'),
      assistantLine({ type: 'text', text: 'c' }, 'req_2'),
    ])
    const usage = events.filter((e) => e.kind === 'usage')
    expect(usage).toHaveLength(2)
    expect(usage.map((u) => u.payload.requestId)).toEqual(['req_1', 'req_2'])
  })

  it('drops thinking_tokens / hook_started / rate_limit noise without raw fallback', () => {
    const { events, raw } = feedAll([
      JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 4 }),
      JSON.stringify({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' }),
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }),
    ])
    expect(events).toHaveLength(0)
    expect(raw).toBe('')
  })

  it('surfaces a failing hook as a system event', () => {
    const { events } = feedAll([
      JSON.stringify({ type: 'system', subtype: 'hook_response', hook_name: 'Stop:check', exit_code: 2 }),
    ])
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ subtype: 'hook_failed', hookName: 'Stop:check', exitCode: 2 })
  })

  it('accumulates mission stats from the result line', () => {
    const parser = createClaudeStreamParser()
    parser.feed(`${INIT_LINE}\n${TOOL_USE_LINE}\n${RESULT_LINE}\n`)
    parser.flush()
    expect(parser.stats()).toMatchObject({
      totalCostUsd: 0.0296784, inputTokens: 18, outputTokens: 176,
      cacheReadTokens: 50944, cacheCreationTokens: 11843, thinkingTokens: 86,
      numTurns: 2, durationMs: 9152, durationApiMs: 3158,
      toolCalls: 1, model: 'claude-sonnet-5',
    })
  })

  it('reassembles lines split across chunk boundaries', () => {
    const parser = createClaudeStreamParser()
    const line = `${TOOL_USE_LINE}\n`
    const first = parser.feed(line.slice(0, 40))
    expect(first.events).toHaveLength(0)
    const second = parser.feed(line.slice(40))
    expect(second.events.some((e) => e.kind === 'tool_use')).toBe(true)
  })

  it('hands unparseable lines back as raw text', () => {
    const { events, raw } = feedAll(['plain progress text', '{"broken json'])
    expect(events).toHaveLength(0)
    expect(raw).toContain('plain progress text')
    expect(raw).toContain('{"broken json')
  })

  it('propagates parent_tool_use_id for subagent attribution', () => {
    const { events } = feedAll([
      assistantLine({ type: 'text', text: 'sub says hi' }, 'req_9', { parent_tool_use_id: 'toolu_parent' }),
    ])
    expect(events.find((e) => e.kind === 'message')?.payload.parentToolUseId).toBe('toolu_parent')
  })

  it('caps oversized tool inputs', () => {
    const big = 'x'.repeat(50_000)
    const { events } = feedAll([assistantLine({ type: 'tool_use', id: 't2', name: 'Write', input: { content: big } })])
    const tool = events.find((e) => e.kind === 'tool_use')
    expect((tool!.payload.input as string).length).toBeLessThan(2100)
  })
})
