import { describe, it, expect } from 'vitest'
import { buildTimeline, classifyTool, heartbeatStale, type ToolItem } from '../timeline'
import type { SessionEvent } from '@/lib/db/schema'

let idCounter = 0
function event(seq: number, kind: string, payload: Record<string, unknown> = {}, toolName: string | null = null): SessionEvent {
  return {
    id: `e${++idCounter}`,
    sessionId: 's1',
    seq,
    kind,
    toolName,
    payload,
    createdAt: new Date('2026-08-21T12:00:00Z'),
  } as SessionEvent
}

describe('buildTimeline', () => {
  it('pairs a tool_result with its tool_use via toolUseId', () => {
    const t = buildTimeline([
      event(1, 'tool_use', { toolUseId: 'tu1', input: '{"command":"ls"}' }, 'Bash'),
      event(2, 'tool_result', { toolUseId: 'tu1', content: 'file.txt', isError: false }),
    ])
    expect(t.items).toHaveLength(1)
    const tool = t.items[0] as ToolItem
    expect(tool.type).toBe('tool')
    expect(tool.toolName).toBe('Bash')
    expect(tool.result).toEqual({ content: 'file.txt', isError: false })
    expect(tool.running).toBe(false)
  })

  it('marks an unanswered tool as running until a terminal event lands', () => {
    const live = buildTimeline([event(1, 'tool_use', { toolUseId: 'tu1' }, 'Read')])
    expect((live.items[0] as ToolItem).running).toBe(true)

    const done = buildTimeline([
      event(1, 'tool_use', { toolUseId: 'tu1' }, 'Read'),
      event(2, 'stop', { exitCode: 0 }),
    ])
    expect((done.items[0] as ToolItem).running).toBe(false)
    expect(done.terminal).toBe(true)
  })

  it('nests subagent events under the spawning Task call', () => {
    const t = buildTimeline([
      event(1, 'tool_use', { toolUseId: 'task1' }, 'Task'),
      event(2, 'tool_use', { toolUseId: 'tu2', parentToolUseId: 'task1' }, 'Grep'),
      event(3, 'thinking', { text: 'sub thinks', parentToolUseId: 'task1' }),
    ])
    expect(t.items).toHaveLength(1)
    const task = t.items[0] as ToolItem
    expect(task.toolClass).toBe('subagent')
    expect(task.children).toHaveLength(2)
    expect((task.children[0] as ToolItem).toolName).toBe('Grep')
  })

  it('an orphaned parent id degrades to top-level instead of dropping the event', () => {
    const t = buildTimeline([event(1, 'message', { stream: 'assistant', text: 'hi', parentToolUseId: 'ghost' })])
    expect(t.items).toHaveLength(1)
    expect(t.items[0].type).toBe('text')
  })

  it('folds usage events into live totals without timeline items', () => {
    const t = buildTimeline([
      event(1, 'usage', { requestId: 'r1', inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheCreationTokens: 20 }),
      event(2, 'usage', { requestId: 'r2', inputTokens: 8, outputTokens: 3, cacheReadTokens: 50, cacheCreationTokens: 0 }),
    ])
    expect(t.items).toHaveLength(0)
    expect(t.totals).toEqual({ requests: 2, inputTokens: 18, outputTokens: 8, cacheReadTokens: 150, cacheCreationTokens: 20 })
  })

  it('reads mission stats off the result event', () => {
    const t = buildTimeline([
      event(1, 'result', {
        status: 'completed', outcome: 'fixed', summary: 'All done.',
        stats: { totalCostUsd: 0.42, toolCalls: 7 },
      }),
    ])
    expect(t.terminal).toBe(true)
    expect(t.stats).toMatchObject({ totalCostUsd: 0.42, toolCalls: 7 })
    expect(t.items[0]).toMatchObject({ type: 'result', status: 'completed', summary: 'All done.' })
  })

  it('renders legacy stdout batches as raw and assistant text as prose', () => {
    const t = buildTimeline([
      event(1, 'message', { stream: 'stdout', text: '{"type":"noise"}' }),
      event(2, 'message', { stream: 'assistant', text: 'Here is the plan.' }),
    ])
    expect(t.items.map((i) => i.type)).toEqual(['raw', 'text'])
  })

  it('maps init and hook_failed system events', () => {
    const t = buildTimeline([
      event(1, 'system', { subtype: 'init', model: 'claude-sonnet-5', permissionMode: 'acceptEdits', version: '2.1.237', toolCount: 18 }),
      event(2, 'system', { subtype: 'hook_failed', hookName: 'Stop:check', exitCode: 2 }),
    ])
    expect(t.items[0]).toMatchObject({ type: 'init', model: 'claude-sonnet-5', toolCount: 18 })
    expect(t.items[1].type).toBe('error')
  })
})

describe('classifyTool', () => {
  it.each([
    ['Bash', 'bash'], ['Read', 'read'], ['Grep', 'search'], ['Edit', 'edit'],
    ['Task', 'subagent'], ['WebSearch', 'web'], ['mcp__aeon__list_tasks', 'mcp'], ['Skill', 'other'],
  ])('%s -> %s', (name, cls) => {
    expect(classifyTool(name)).toBe(cls)
  })
})

describe('heartbeatStale', () => {
  const now = new Date('2026-08-21T12:10:00Z').getTime()

  it('is false for a fresh beat, null beat, and true past 90s', () => {
    expect(heartbeatStale(new Date(now - 30_000), now)).toBe(false)
    expect(heartbeatStale(null, now)).toBe(false)
    expect(heartbeatStale(new Date(now - 120_000), now)).toBe(true)
  })
})
