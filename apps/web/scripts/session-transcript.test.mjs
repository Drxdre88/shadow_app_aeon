import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranscript } from './session-transcript.mjs'

test('preserves Claude transcript records', () => {
  const records = [
    { type: 'user', message: { content: 'Plan the release' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
  ]

  const result = normalizeTranscript(records)

  assert.equal(result.client, 'claude')
  assert.equal(result.messages, records)
})

test('normalizes Codex messages and custom tool calls', () => {
  const records = [
    { type: 'session_meta', payload: { cwd: 'C:/repo' } },
    {
      timestamp: '2026-08-30T12:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix capture' }] },
    },
    {
      timestamp: '2026-08-30T12:01:00.000Z',
      type: 'response_item',
      payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.exec_command({})' },
    },
    {
      timestamp: '2026-08-30T12:02:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed' }] },
    },
  ]

  const result = normalizeTranscript(records)

  assert.equal(result.client, 'codex')
  assert.deepEqual(result.messages.map((message) => message.type), ['user', 'assistant', 'assistant'])
  assert.equal(result.messages[0].message.content[0].text, 'Fix capture')
  assert.equal(result.messages[1].message.content[0].name, 'exec')
  assert.equal(result.messages[2].message.content[0].text, 'Fixed')
  assert.equal(result.messages[0].cwd, 'C:/repo')
})

test('decodes Codex function arguments', () => {
  const records = [{
    type: 'response_item',
    payload: { type: 'function_call', name: 'apply_patch', arguments: '{"file_path":"src/app.ts"}' },
  }]

  const result = normalizeTranscript(records)

  assert.deepEqual(result.messages[0].message.content[0].input, { file_path: 'src/app.ts' })
})

test('drops Codex harness-only recommended plugin messages', () => {
  const records = [
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<recommended_plugins>injected</recommended_plugins>' }],
        internal_chat_message_metadata_passthrough: {
          content_item_kinds: ['plugins.recommendations', 'agents_md.instructions'],
        },
      },
    },
    {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Real prompt' }] },
    },
  ]

  const result = normalizeTranscript(records)

  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].message.content[0].text, 'Real prompt')
})

test('extracts files from Codex exec-wrapped apply_patch calls', () => {
  const patchCall = String.raw`const patch = "*** Begin Patch\n*** Update File: C:\\repo\\src\\one.ts\n@@\n-old\n+new\n*** Add File: C:\\repo\\src\\two.ts\n+new\n*** End Patch"; await tools.apply_patch(patch)`
  const records = [{
    type: 'response_item',
    payload: { type: 'custom_tool_call', name: 'exec', input: patchCall },
  }]

  const result = normalizeTranscript(records)
  const content = result.messages[0].message.content

  assert.equal(content.length, 1)
  assert.deepEqual(content[0].input.file_paths, [
    'C:\\repo\\src\\one.ts',
    'C:\\repo\\src\\two.ts',
  ])
})

test('preserves a declared Copilot client on normalized records', () => {
  const records = [
    { type: 'session_meta', payload: { client: 'copilot', cwd: 'C:/repo' } },
    { type: 'user', message: { content: 'Prepare capture' } },
    { type: 'assistant', message: { content: 'Done' } },
  ]

  const result = normalizeTranscript(records)

  assert.equal(result.client, 'copilot')
  assert.deepEqual(result.messages, records.slice(1))
})
