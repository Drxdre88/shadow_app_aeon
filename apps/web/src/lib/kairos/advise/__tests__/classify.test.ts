import { describe, expect, it } from 'vitest'
import { classifyAdviceTurn, OFFER_QUESTION, type AdviceTurn } from '../classify'
import { adviceStyleLines } from '../lines'

const OFFER = `So the core is you want to ship before the trip. ${OFFER_QUESTION}`
const user = (content: string) => ({ role: 'user' as const, content })
const kairos = (content: string) => ({ role: 'assistant' as const, content })
const turn = (userBody: string, history: AdviceTurn['history'] = []): AdviceTurn => ({ userBody, history })

describe('classifyAdviceTurn', () => {
  it.each([
    ["I'm planning to move the launch to Friday so the team gets a weekend off", 'offer', 'plan'],
    ["I'm stuck on the pricing page and not sure what to cut from it first", 'offer', 'problem'],
    ['ugh, stuck', 'none', 'too_short'],
    ['Shipped the release, all green', 'none', 'no_signal'],
    ['Should I move the launch to Friday?', 'advise', 'explicit_ask'],
    ["I'm planning to move the launch. What do you think?", 'advise', 'explicit_ask'],
  ])('%s → %s', (body, mode, reason) => {
    expect(classifyAdviceTurn(turn(body))).toEqual({ mode, reason })
  })

  it('the reply to the offer decides: take → advise, think aloud → listen', () => {
    expect(classifyAdviceTurn(turn('yes, go on', [user('plan…'), kairos(OFFER)])).mode).toBe('advise')
    expect(classifyAdviceTurn(turn('let me think it through first', [user('plan…'), kairos(OFFER)])).mode).toBe('listen')
    expect(classifyAdviceTurn(turn('anyway, lunch was good', [user('plan…'), kairos(OFFER)]))).toEqual({ mode: 'none', reason: 'offer_ignored' })
  })

  it('listen is sticky inside the window until an explicit ask', () => {
    const history = [user('plan…'), kairos(OFFER), user('just venting really'), kairos('What feels heaviest?')]
    expect(classifyAdviceTurn(turn('probably the client call tomorrow, honestly', history)).mode).toBe('listen')
    expect(classifyAdviceTurn(turn('ok, what would you do?', history)).mode).toBe('advise')
  })

  it('does not repeat the offer inside the window; offers again once it scrolls out', () => {
    const body = "I'm thinking about quitting the side project to focus on the main one"
    const recent = [user('plan…'), kairos(OFFER), user('no thanks'), kairos('Fair.')]
    expect(classifyAdviceTurn(turn(body, recent))).toEqual({ mode: 'none', reason: 'offer_recent' })
    const old = [...recent, ...Array.from({ length: 8 }, (_, i) => (i % 2 ? kairos('ok') : user('more')))]
    expect(classifyAdviceTurn(turn(body, old)).mode).toBe('offer')
  })

  it('only the first reply can take the offer with a loose "yes"; "not sure" is not a yes', () => {
    expect(classifyAdviceTurn(turn('not sure', [user('plan…'), kairos(OFFER)])).mode).toBe('none')
    expect(classifyAdviceTurn(turn('sure', [user('plan…'), kairos(OFFER)])).mode).toBe('advise')
    const history = [user('plan…'), kairos(OFFER), user('hmm, not sure yet'), kairos('Take your time.')]
    expect(classifyAdviceTurn(turn('yes ok', history)).mode).toBe('none')
  })
})

describe('adviceStyleLines', () => {
  it('offer asks the exact question; stance suppressed only when cold read is on', () => {
    const on = adviceStyleLines('offer', { coldRead: true })
    expect(on[0]).toContain(OFFER_QUESTION)
    expect(on).toContain('- No `<stance>` line on this turn.')
    expect(adviceStyleLines('offer', { coldRead: false }).join('\n')).not.toContain('stance')
    expect(adviceStyleLines('listen', { coldRead: true })).toContain('- No `<stance>` line on this turn.')
  })

  it('advise puts the view last and keeps the stance; none adds nothing', () => {
    const lines = adviceStyleLines('advise', { coldRead: true })
    expect(lines.join('\n')).toContain("'My take:'")
    expect(lines.join('\n')).not.toContain('stance')
    expect(adviceStyleLines('none', { coldRead: true })).toEqual([])
  })
})
