import type { Memory } from '@/lib/db/schema'
import type { MemoryLink } from './validators'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 1 — canonical markdown serializer for memories.
// Emits the exact format documented in docs/brain/03-markdown-format.md.
// The DB is the index; this .md output is the source-of-truth a human
// (or git) can hold.
//
// Phase 1 ships the writer only. The parser + bulk zip export + import
// arrive in Phase 1.5 once the round-trip contract is being exercised.
// ─────────────────────────────────────────────────────────────────────────

export type MemoryToMarkdownOpts = {
  // Optional resolved names for anchor IDs. The caller (export route) is
  // responsible for looking up these names because resolving them inside
  // the serializer would couple it to the DB layer. If a name is not
  // provided, the UUID is emitted instead.
  realmName?:   string | null
  projectName?: string | null
  taskName?:    string | null
}

const FRONTMATTER_KEY_ORDER = [
  'id',
  'title',
  'type',
  'source',
  'created',
  'updated',
  'realm',
  'project',
  'task',
  'tags',
  'pinned',
  'source_metadata',
  'links',
  'summary',
] as const

export function memoryToMarkdown(memory: Memory, opts: MemoryToMarkdownOpts = {}): string {
  const frontmatter: Record<string, unknown> = {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    source: memory.source,
    created: memory.createdAt.toISOString(),
    updated: memory.updatedAt.toISOString(),
    realm:   memory.realmId   ? (opts.realmName   ?? memory.realmId)   : null,
    project: memory.projectId ? (opts.projectName ?? memory.projectId) : null,
    task:    memory.taskId    ? (opts.taskName    ?? memory.taskId)    : null,
    tags: (memory.tags as string[]) ?? [],
    pinned: memory.pinned,
    source_metadata: (memory.sourceMetadata as Record<string, unknown>) ?? {},
    links: (memory.links as MemoryLink[]) ?? [],
    summary: memory.summary ?? null,
  }

  const yaml = FRONTMATTER_KEY_ORDER.map((k) => emitYamlPair(k, frontmatter[k], 0)).join('')
  return `---\n${yaml}---\n\n# ${memory.title}\n\n${memory.bodyMd}\n`
}

// ─── minimal YAML emitter for our restricted shape ─────────────────────
// Handles: strings (auto-quoting when needed), numbers, booleans, null,
// arrays of strings, arrays of objects, nested objects, block scalars.
// Does NOT attempt to be a general YAML library.

function emitYamlPair(key: string, value: unknown, indent: number): string {
  const pad = ' '.repeat(indent)
  if (value === null || value === undefined) return `${pad}${key}: null\n`
  if (typeof value === 'boolean')             return `${pad}${key}: ${value}\n`
  if (typeof value === 'number')              return `${pad}${key}: ${value}\n`
  if (typeof value === 'string') {
    if (key === 'summary' && (value.includes('\n') || value.length > 60)) {
      return `${pad}${key}: |\n${indentBlock(value, indent + 2)}`
    }
    return `${pad}${key}: ${formatScalar(value)}\n`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []\n`
    let out = `${pad}${key}:\n`
    for (const item of value) {
      if (item === null) {
        out += `${pad}  - null\n`
      } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        out += `${pad}  - ${formatScalar(String(item))}\n`
      } else if (typeof item === 'object') {
        out += `${pad}  -\n` + emitYamlObject(item as Record<string, unknown>, indent + 4)
      }
    }
    return out
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return `${pad}${key}: {}\n`
    return `${pad}${key}:\n` + emitYamlObject(value as Record<string, unknown>, indent + 2)
  }
  return `${pad}${key}: ${formatScalar(String(value))}\n`
}

function emitYamlObject(obj: Record<string, unknown>, indent: number): string {
  return Object.entries(obj).map(([k, v]) => emitYamlPair(k, v, indent)).join('')
}

function formatScalar(s: string): string {
  // Quote when string contains YAML-special characters, leading/trailing whitespace,
  // looks like a number/boolean, is empty, or begins with characters that confuse parsers.
  const needsQuote =
    s === '' ||
    /^[\s]|[\s]$/.test(s) ||
    /[:#\[\]{}&*!|>'"%@`,]/.test(s) ||
    /^(true|false|null|yes|no|~)$/i.test(s) ||
    /^-?\d+(\.\d+)?$/.test(s) ||
    s.startsWith('-') ||
    s.startsWith('?')

  if (!needsQuote) return s
  // Double-quote with JSON-style escaping — round-trip safe.
  return JSON.stringify(s)
}

function indentBlock(text: string, indent: number): string {
  const pad = ' '.repeat(indent)
  return text.split('\n').map((line) => `${pad}${line}`).join('\n') + '\n'
}

// ─── content-type helper used by the export route ──────────────────────
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'
