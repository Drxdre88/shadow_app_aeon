import { describe, expect, it } from 'vitest'
import { detectSensitiveTopics } from '../lexicon'

describe('detectSensitiveTopics', () => {
  it('finds each topic from a personal phrase', () => {
    expect(detectSensitiveTopics('Saw my therapist about the anxiety again')).toEqual(['health'])
    expect(detectSensitiveTopics('Argued with my wife about the move')).toEqual(['relationships'])
    expect(detectSensitiveTopics('The credit card is maxed and I am in debt')).toEqual(['money'])
    expect(detectSensitiveTopics('Called my lawyer about the tribunal')).toEqual(['legal'])
    expect(detectSensitiveTopics('Talked politics before the election')).toEqual(['beliefs'])
  })

  it('returns several topics in a fixed order', () => {
    expect(detectSensitiveTopics('Divorce lawyer bills after my diagnosis')).toEqual(['health', 'relationships'])
    expect(detectSensitiveTopics('My dad needs surgery and the mortgage is due')).toEqual(['health', 'relationships', 'money'])
  })

  it('ignores ordinary work notes that share words', () => {
    expect(detectSensitiveTopics('Paid down tech debt in the board store')).toEqual([])
    expect(detectSensitiveTopics('Refactor the court-of-appeal style review queue? no — food court lunch')).toEqual([])
    expect(detectSensitiveTopics('Health check endpoint returns 200; partnership API')).toEqual([])
    expect(detectSensitiveTopics('Use a policy object; the policeman pattern')).toEqual([])
  })

  it('matches on word boundaries and is case-insensitive, including curly apostrophes', () => {
    expect(detectSensitiveTopics('HOSPITAL visit')).toEqual(['health'])
    expect(detectSensitiveTopics('I can\u2019t afford the rent')).toEqual(['money'])
    expect(detectSensitiveTopics('hospitality sector deck')).toEqual([])
  })

  it('handles empty input', () => {
    expect(detectSensitiveTopics('')).toEqual([])
    expect(detectSensitiveTopics(null)).toEqual([])
  })
})
