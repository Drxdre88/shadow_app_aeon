import { describe, it, expect, vi } from 'vitest'
import { buildRepairPrompt, parseWithRepair, ParseRepairError } from '../_prompt-utils'

// Repair-path contract: the round-trip must be able to carry the generator's
// own system block + reference context (e.g. valid citation ids), because a
// context-dependent mistake is unrepairable from broken JSON + error alone
// (2026-07-24 Shadow Apps introspection trace).

const BROKEN = '```json\n{ "proposals": [ }\n```'

describe('buildRepairPrompt', () => {
  it('includes the reference context section when provided', () => {
    const prompt = buildRepairPrompt(BROKEN, new Error('bad'), 'introspection', 'Valid ids:\n- abc')
    expect(prompt).toContain('## Reference context')
    expect(prompt).toContain('Valid ids:\n- abc')
    // Context must come before the (long) previous response so it stays salient.
    expect(prompt.indexOf('## Reference context')).toBeLessThan(prompt.indexOf('## Previous response'))
  })

  it('omits the section when no context is given', () => {
    expect(buildRepairPrompt(BROKEN, new Error('bad'), 'introspection')).not.toContain('## Reference context')
  })
})

describe('parseWithRepair — repair call enrichment', () => {
  it('sends system + cacheSystem and the repair context on the repair call', async () => {
    const ask = vi.fn().mockResolvedValue({ text: '{"ok":true}' })
    const parse = vi.fn()
      .mockImplementationOnce(() => { throw new Error('first parse fails') })
      .mockReturnValueOnce({ ok: true })

    const result = await parseWithRepair({
      provider: { ask },
      rawText: BROKEN,
      parse,
      generatorLabel: 'introspection',
      system: 'SYSTEM BLOCK',
      repairContext: 'Valid ids:\n- abc',
    })

    expect(result).toEqual({ ok: true })
    expect(ask).toHaveBeenCalledTimes(1)
    const req = ask.mock.calls[0][0]
    expect(req.system).toBe('SYSTEM BLOCK')
    expect(req.cacheSystem).toBe(true)
    expect(req.prompt).toContain('## Reference context')
  })

  it('omits system entirely when not provided (existing callers unchanged)', async () => {
    const ask = vi.fn().mockResolvedValue({ text: '{"ok":true}' })
    const parse = vi.fn()
      .mockImplementationOnce(() => { throw new Error('first parse fails') })
      .mockReturnValueOnce({ ok: true })

    await parseWithRepair({ provider: { ask }, rawText: BROKEN, parse, generatorLabel: 'cortex' })

    const req = ask.mock.calls[0][0]
    expect('system' in req).toBe(false)
    expect(req.prompt).not.toContain('## Reference context')
  })

  it('still throws ParseRepairError when both attempts fail', async () => {
    const ask = vi.fn().mockResolvedValue({ text: 'still broken' })
    const parse = vi.fn(() => { throw new Error('nope') })

    await expect(
      parseWithRepair({ provider: { ask }, rawText: BROKEN, parse, generatorLabel: 'introspection', system: 'S' }),
    ).rejects.toThrow(ParseRepairError)
  })
})
