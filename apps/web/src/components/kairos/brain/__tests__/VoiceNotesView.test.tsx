/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VOICE_NOTE_PROJECT_INSTRUCTION, VoiceNotesView } from '../VoiceNotesView'

afterEach(() => cleanup())

describe('VoiceNotesView', () => {
  it('explains the flow and the one-tap confirm in plain words', () => {
    render(<VoiceNotesView />)
    expect(screen.getByText('Dictate')).toBeTruthy()
    expect(screen.getByText(/Start with/).textContent).toContain('“note for Kairos”')
    expect(screen.getByText(/one-tap confirm in the Kairos inbox/)).toBeTruthy()
    expect(screen.getByText(/counts as your own/)).toBeTruthy()
    expect(screen.getByText(VOICE_NOTE_PROJECT_INSTRUCTION)).toBeTruthy()
  })

  it('copies the claude.ai Project instruction', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<VoiceNotesView />)
    fireEvent.click(screen.getByRole('button', { name: /Copy instruction/ }))
    expect(writeText).toHaveBeenCalledWith(VOICE_NOTE_PROJECT_INSTRUCTION)
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('carries the exact instruction the tool expects', () => {
    expect(VOICE_NOTE_PROJECT_INSTRUCTION).toContain('kairos_voice_note')
    expect(VOICE_NOTE_PROJECT_INSTRUCTION).toContain('claudeSummary')
    expect(VOICE_NOTE_PROJECT_INSTRUCTION).toContain('list_dominions')
  })
})
