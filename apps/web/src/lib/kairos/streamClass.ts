export const STREAM_CLASSES = [
  'idea',
  'agentic',
  'execution',
  'reflection',
  'cortex',
  'archetype',
  'advisory',
  'trace',
] as const

export type StreamClass = (typeof STREAM_CLASSES)[number]

export function isStreamClass(value: unknown): value is StreamClass {
  return typeof value === 'string' && (STREAM_CLASSES as readonly string[]).includes(value)
}
