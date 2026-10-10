import { clipAtWord } from '@/lib/kairos/clip-words'

// Markdown → plain speech for the voice line. Pure, no I/O. Everything a
// screen needs but a listener can't use (fences, headings, list markers,
// emphasis, links, tables, citations, hidden stance tags, emoji) is removed;
// line breaks become sentence breaks so the TTS voice pauses where a reader
// would.

export const VOICE_FEED_TEXT_MAX_CHARS = 400

const FENCED_CODE = /```[\s\S]*?(```|$)/g
const STANCE_CLOSED = /<\s*stance\s*>[\s\S]*?<\s*\/\s*stance\s*>/gi
const STANCE_DANGLING = /<\s*stance\s*>[\s\S]*$/i
const CITATION = /\s*\[\[[^\]]*\]\]/g
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
const BARE_URL = /\bhttps?:\/\/\S+/g
const HTML_TAG = /<\/?[a-z][^>]*>/gi
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const SENTENCE_END = /[.!?…:;]["'”’)]*$/

function cleanLine(line: string): string {
  if (TABLE_RULE.test(line)) return ''
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(>!?|>>!?)+\s?/, '')
    .replace(/^\s*([-*+•]|\d{1,3}[.)])\s+/, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/\|\|([^|]+)\|\|/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/[*_~`#]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
}

// Plain spoken text. `max` clips at a word boundary with an ellipsis.
export function toSpeechText(markdown: string, max?: number): string {
  const lines = markdown
    .replace(STANCE_CLOSED, ' ')
    .replace(STANCE_DANGLING, ' ')
    .replace(FENCED_CODE, ' ')
    .replace(CITATION, '')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(BARE_URL, '')
    .replace(HTML_TAG, ' ')
    .replace(EMOJI, '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
  const text = lines
    .map((line, i) => (i < lines.length - 1 && !SENTENCE_END.test(line) ? `${line}.` : line))
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return max !== undefined ? clipAtWord(text, max) : text
}
