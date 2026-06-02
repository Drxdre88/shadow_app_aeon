/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChatMessage } from '@/lib/data/kairos-chat'
import {
  buildTitleMap,
  formatReadingLine,
  truncateTitle,
  renderWithCitations,
  formatReason,
} from '../kairos-citations'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const UNKNOWN = '99999999-9999-4999-8999-999999999999'

type Retrieval = ChatMessage['retrieval']

function meta(overrides: Partial<NonNullable<Retrieval>> = {}): NonNullable<Retrieval> {
  return {
    cortex: { id: A, title: 'AEON cortex' },
    archetypes: [{ id: B, title: 'Kairos brain build-out' }],
    substrate: [],
    ...overrides,
  }
}

describe('formatReadingLine', () => {
  it('returns null when retrieval is null', () => {
    expect(formatReadingLine(null)).toBeNull()
  })

  it('returns null when every bucket is empty', () => {
    expect(formatReadingLine({ cortex: null, archetypes: [], substrate: [] })).toBeNull()
  })

  it('renders cortex-only as Reading: cortex', () => {
    expect(formatReadingLine({ cortex: { id: A, title: 'c' }, archetypes: [], substrate: [] }))
      .toBe('Reading: cortex')
  })

  it('singularises 1 archetype, pluralises 2', () => {
    expect(formatReadingLine({ cortex: null, archetypes: [{ id: B, title: 'x' }], substrate: [] }))
      .toBe('Reading: 1 archetype')
    expect(formatReadingLine({
      cortex: null,
      archetypes: [{ id: B, title: 'x' }, { id: A, title: 'y' }],
      substrate: [],
    })).toBe('Reading: 2 archetypes')
  })

  it('singularises 1 memory as memory, pluralises 2 as memories', () => {
    expect(formatReadingLine({ cortex: null, archetypes: [], substrate: [{ id: A, title: 's' }] }))
      .toBe('Reading: 1 memory')
    expect(formatReadingLine({
      cortex: null,
      archetypes: [],
      substrate: [{ id: A, title: 's' }, { id: B, title: 't' }],
    })).toBe('Reading: 2 memories')
  })

  it('joins all three buckets with mid-dot separators', () => {
    expect(formatReadingLine({
      cortex: { id: A, title: 'c' },
      archetypes: [{ id: B, title: 'a' }, { id: UNKNOWN, title: 'a2' }],
      substrate: [{ id: A, title: 's' }, { id: B, title: 's2' }],
    })).toBe('Reading: cortex · 2 archetypes · 2 memories')
  })
})

describe('buildTitleMap', () => {
  it('returns empty map for null retrieval', () => {
    expect(buildTitleMap(null).size).toBe(0)
  })

  it('lowercases ids so chip lookup is case-insensitive', () => {
    const upper = A.toUpperCase()
    const map = buildTitleMap({
      cortex: { id: upper, title: 'cortex' },
      archetypes: [],
      substrate: [],
    })
    expect(map.get(A)).toBe('cortex')
  })

  it('merges all three buckets into one lookup', () => {
    const map = buildTitleMap(meta({ substrate: [{ id: UNKNOWN, title: 'sub' }] }))
    expect(map.size).toBe(3)
    expect(map.get(A)).toBe('AEON cortex')
    expect(map.get(B)).toBe('Kairos brain build-out')
    expect(map.get(UNKNOWN)).toBe('sub')
  })
})

describe('truncateTitle', () => {
  it('returns input unchanged when at or under max', () => {
    expect(truncateTitle('short', 28)).toBe('short')
    expect(truncateTitle('x'.repeat(28), 28)).toBe('x'.repeat(28))
  })

  it('truncates and appends ellipsis when over max', () => {
    const out = truncateTitle('x'.repeat(29), 28)
    expect(out).toHaveLength(28)
    expect(out.endsWith('…')).toBe(true)
  })

  it('trims surrounding whitespace before checking length', () => {
    expect(truncateTitle('   short   ', 28)).toBe('short')
  })
})

describe('renderWithCitations', () => {
  it('returns the original text when no citations present', () => {
    const titles = buildTitleMap(meta())
    const { container } = render(<>{renderWithCitations('hello world', titles)}</>)
    expect(container.textContent).toBe('hello world')
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })

  it('renders a chip with truncated title for a known id', () => {
    const titles = buildTitleMap(meta())
    render(<>{renderWithCitations(`see [[${A}]]`, titles)}</>)
    const chip = screen.getByTitle('AEON cortex')
    expect(chip.textContent).toBe('AEON cortex')
  })

  it('renders a muted ? chip for an unknown id', () => {
    const titles = buildTitleMap(meta())
    const { container } = render(<>{renderWithCitations(`unknown [[${UNKNOWN}]]`, titles)}</>)
    const unknown = container.querySelector('span[title="Unknown memory id"]')
    expect(unknown?.textContent).toBe('?')
  })

  it('preserves surrounding text segments in order', () => {
    const titles = buildTitleMap(meta())
    const { container } = render(<>{renderWithCitations(
      `prefix [[${A}]] middle [[${UNKNOWN}]] tail`,
      titles,
    )}</>)
    expect(container.textContent).toBe('prefix AEON cortex middle ? tail')
  })

  it('handles empty content as an empty render', () => {
    const titles = buildTitleMap(meta())
    const { container } = render(<>{renderWithCitations('', titles)}</>)
    expect(container.textContent).toBe('')
  })

  it('lowercases incoming uuids so uppercase emissions still match', () => {
    const titles = buildTitleMap(meta())
    const { container } = render(<>{renderWithCitations(`see [[${A.toUpperCase()}]]`, titles)}</>)
    expect(container.textContent).toBe('see AEON cortex')
  })
})

describe('formatReason', () => {
  it('returns specific copy per reason', () => {
    expect(formatReason('unauthorized')).toBe('Not signed in.')
    expect(formatReason('dominion_not_found')).toBe('That Dominion is not accessible.')
    expect(formatReason('thread_not_found')).toBe('Thread was removed.')
    expect(formatReason('no_credential')).toContain('BYOK')
    expect(formatReason('ai_empty')).toContain('empty')
  })

  it('embeds the message into ai_failed when provided', () => {
    expect(formatReason('ai_failed', 'rate limited')).toBe('Kairos failed: rate limited')
    expect(formatReason('ai_failed')).toBe('Kairos failed. Try again.')
  })

  it('embeds the message into invalid_input when provided', () => {
    expect(formatReason('invalid_input', 'body too long')).toBe('Invalid input: body too long')
  })
})
