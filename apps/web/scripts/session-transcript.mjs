const TOOL_ITEM_TYPES = new Set([
  'custom_tool_call',
  'function_call',
  'local_shell_call',
  'mcp_tool_call',
])

function decodeToolInput(payload) {
  const raw = payload.arguments ?? payload.input ?? payload.action ?? {}
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return payload.name === 'apply_patch' ? { patch: raw } : { input: raw }
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return []
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return null
      const text = block.text ?? block.input_text ?? block.output_text
      return typeof text === 'string' ? { type: 'text', text } : null
    })
    .filter(Boolean)
}

function isInjectedCodexUserContent(content) {
  if (!Array.isArray(content)) return false
  const text = content.map((block) => block?.text).filter((value) => typeof value === 'string').join('').trim()
  return text.startsWith('<recommended_plugins>') && text.endsWith('</recommended_plugins>')
}

function extractPatchFilePaths(raw) {
  if (typeof raw !== 'string' || !raw.includes('*** Begin Patch')) return []
  const paths = []
  const header = /\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+?)(?=\\n|\r?\n)/g
  for (const match of raw.matchAll(header)) {
    const path = match[1].replace(/\\\\/g, '\\').trim()
    if (path) paths.push(path)
  }
  return [...new Set(paths)]
}

function normalizeCodexTranscript(records) {
  const cwd = records.find((record) => record?.type === 'session_meta')?.payload?.cwd
  const messages = []

  for (const record of records) {
    if (record?.type !== 'response_item') continue
    const payload = record.payload
    if (!payload || typeof payload !== 'object') continue

    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      const content = normalizeContent(payload.content)
      const contentKinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds
      const isHarnessContent = Array.isArray(contentKinds) && !contentKinds.includes('user.text')
      if (payload.role === 'user' && (isHarnessContent || isInjectedCodexUserContent(content))) continue
      messages.push({
        type: payload.role,
        message: { content },
        timestamp: record.timestamp,
        cwd,
      })
      continue
    }

    if (TOOL_ITEM_TYPES.has(payload.type)) {
      const decodedInput = decodeToolInput(payload)
      const patchPaths = extractPatchFilePaths(payload.arguments ?? payload.input)
      const input = patchPaths.length > 0 && decodedInput && typeof decodedInput === 'object'
        ? { ...decodedInput, file_paths: patchPaths }
        : decodedInput
      messages.push({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: payload.name || payload.type,
            input,
          }],
        },
        timestamp: record.timestamp,
        cwd,
      })
    }
  }

  return messages
}

export function normalizeTranscript(records) {
  const declaredClient = records.find(
    (record) => record?.type === 'session_meta' && typeof record?.payload?.client === 'string',
  )?.payload?.client
  const directMessages = records.filter(
    (record) => (record?.type === 'user' || record?.type === 'assistant') && record.message,
  )
  if (directMessages.length > 0) {
    return {
      client: declaredClient || 'claude',
      messages: declaredClient ? directMessages : records,
    }
  }

  const isCodex = records.some((record) =>
    record?.type === 'response_item' || record?.type === 'session_meta' || record?.type === 'turn_context',
  )
  return isCodex
    ? { client: 'codex', messages: normalizeCodexTranscript(records) }
    : { client: 'claude', messages: records }
}
