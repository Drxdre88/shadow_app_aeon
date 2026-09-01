import test from 'node:test'
import assert from 'node:assert/strict'

import { truncate, deriveAiTitle } from './session-title.mjs'

// memoryCreateSchema: aiTitle is z.string().trim().min(1).max(120)
const AI_TITLE_MAX = 120

test('truncate never exceeds n — the ellipsis counts', () => {
  assert.equal(truncate('abcdef', 10), 'abcdef')
  assert.equal(truncate('abcdef', 6), 'abcdef')

  const cut = truncate('abcdef', 4)
  assert.equal(cut, 'abc…')
  assert.equal(cut.length, 4)

  // The regression: slicing to n and appending returned n+1.
  const long = 'x'.repeat(500)
  assert.equal(truncate(long, AI_TITLE_MAX).length, AI_TITLE_MAX)

  assert.equal(truncate('', 10), '')
  assert.equal(truncate(null, 10), '')
  assert.equal(truncate('abc', 1), '…')
  assert.equal(truncate('abc', 0), '')
})

test('a long first prompt yields a title the API will accept', () => {
  // The exact shape that dead-lettered a real session: a pasted Windows path
  // as the opening token, so eight "words" ran well past the column limit.
  const prompt =
    'c:\\Users\\anselikhov\\data_science\\dev_26\\shadow_data_lab\\packages\\sl-data-shockwave\n\n\n' +
    '#Henley_Fixed # Client Site Emsys Global something something more text here'

  const title = deriveAiTitle(prompt)
  assert.ok(title.length <= AI_TITLE_MAX, `title was ${title.length} chars`)
  assert.ok(title.endsWith('…'))
})

test('no prompt is short enough to overflow, whatever the input', () => {
  const inputs = [
    'x'.repeat(5000),
    Array.from({ length: 8 }, () => 'y'.repeat(60)).join(' '),
    'https://example.com/' + 'z'.repeat(400),
    'a b c d e f g h i j k l m n o p',
  ]
  for (const input of inputs) {
    assert.ok(deriveAiTitle(input).length <= AI_TITLE_MAX, `overflowed on: ${input.slice(0, 40)}`)
  }
})

test('derives a readable headline and strips the usual noise', () => {
  assert.equal(deriveAiTitle('/checkpoint commit the gantt work'), 'commit the gantt work')
  assert.equal(deriveAiTitle('Can you fix the board please'), 'fix the board please')
  assert.equal(deriveAiTitle('please  collapse   whitespace'), 'collapse whitespace')
  assert.equal(deriveAiTitle('one two three four five six seven eight nine ten'),
    'one two three four five six seven eight')

  assert.equal(deriveAiTitle(''), '')
  assert.equal(deriveAiTitle(null), '')
})
