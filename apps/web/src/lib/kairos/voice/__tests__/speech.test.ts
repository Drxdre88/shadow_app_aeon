import { describe, expect, it } from 'vitest'
import { toSpeechText } from '../speech-text'
import { SpeechChunker } from '../speech-chunker'

describe('toSpeechText', () => {
  it('strips markdown, citations, stance tags and emoji into plain sentences', () => {
    const md = [
      '## Status 🚀',
      '**Swarm** build is _stuck_ [[11111111-1111-4111-8111-111111111111]]',
      '- first `item`',
      '1. second [link](https://x.test)',
      '> quoted line',
      '```ts\nconst x = 1\n```',
      '<stance>mixed — gist. here</stance>',
    ].join('\n')
    expect(toSpeechText(md)).toBe('Status. Swarm build is stuck. first item. second link. quoted line')
  })

  it('drops tables rules and spoilers keep their words', () => {
    expect(toSpeechText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a, b. 1, 2')
    expect(toSpeechText('My guess: ||you will ship||')).toBe('My guess: you will ship')
  })

  it('caps at a word boundary with an ellipsis', () => {
    const out = toSpeechText('word '.repeat(200), 400)
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('SpeechChunker', () => {
  function run(deltas: string[]): string[] {
    const out: string[] = []
    const chunker = new SpeechChunker((s) => out.push(s))
    for (const d of deltas) chunker.push(d)
    chunker.flush()
    return out
  }

  it('emits whole sentences as they complete', () => {
    const out: string[] = []
    const chunker = new SpeechChunker((s) => out.push(s))
    chunker.push('The build is ')
    expect(out).toEqual([])
    chunker.push('stuck. Want me')
    expect(out).toEqual(['The build is stuck.'])
    chunker.push(' to look?')
    chunker.flush()
    expect(out).toEqual(['The build is stuck.', 'Want me to look?'])
  })

  it('never speaks a citation or stance tag split across deltas', () => {
    const out = run(['It shipped [[1111', '-2222]]. Good. <stance>endorse — ', 'ship it. now</stance>'])
    expect(out.join(' ')).toBe('It shipped. Good.')
  })
})
