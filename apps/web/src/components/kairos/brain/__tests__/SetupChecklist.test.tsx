/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { KairosBrainStatus, KairosSetupSignals } from '@/lib/kairos/routines/status-types'

vi.mock('@/lib/actions/kairos-brain', () => ({ sendKairosTestMessage: vi.fn() }))

import { sendKairosTestMessage } from '@/lib/actions/kairos-brain'
import { claudeConnectorInstallUrl, CLAUDE_ROUTINES_URL } from '@/lib/kairos/routines/setup'
import { getRoutine, routinePrompt } from '@/lib/kairos/routines/catalog'
import { SetupChecklist } from '../SetupChecklist'
import { VOICE_NOTE_PROJECT_INSTRUCTION } from '../VoiceNotesBody'
import { requiredMissing } from '../setupProgress'

const SIGNALS: KairosSetupSignals = {
  connectorUsedAt: null,
  sessions: { claude: null, codex: null, copilot: null },
  voiceNoteAt: null,
  watchedBoards: 0,
  telegramConfigured: false,
}

function status(overrides: Partial<KairosBrainStatus> = {}, setup: Partial<KairosSetupSignals> | null = {}): KairosBrainStatus {
  return {
    generatedAt: '2026-10-02T07:00:00.000Z',
    appUrl: 'https://aeon.example',
    mcpUrl: 'https://aeon.example/api/mcp',
    lastNight: { routine: 0, backup: 0, missed: 0 },
    backupKinds: [],
    kinds: [],
    routines: [
      { id: 'brain', lastClaimAt: null, state: 'silent' },
      { id: 'chat', lastClaimAt: null, state: 'off' },
    ],
    telegram: { routineFlagOn: false, routineConfigured: false },
    isAdmin: false,
    setup: setup === null ? undefined : { ...SIGNALS, ...setup },
    ...overrides,
  }
}

const LIVE_BRAIN = { routines: [
  { id: 'brain' as const, lastClaimAt: '2026-10-02T05:40:00.000Z', state: 'live' as const },
  { id: 'chat' as const, lastClaimAt: null, state: 'off' as const },
] }

const renderList = (s: KairosBrainStatus, onOpenWatched = () => {}) =>
  render(<SetupChecklist status={s} refreshing={false} onRefresh={() => {}} onOpenWatched={onOpenWatched} />)

const stepRow = (title: string) => screen.getByRole('button', { name: new RegExp(title) }).closest('[data-tick]') as HTMLElement
const openOptional = () => fireEvent.click(screen.getByRole('button', { name: /Make Kairos see and hear more/ }))

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  window.localStorage.clear()
})
afterEach(() => { cleanup(); vi.mocked(sendKairosTestMessage).mockReset() })

describe('SetupChecklist — required steps', () => {
  it('starts at 0 of 2 with the connect step open', () => {
    renderList(status())
    expect(screen.getByText(/2 steps · ~5 minutes/)).toBeTruthy()
    expect(screen.getByText('0 of 2 required done')).toBeTruthy()
    expect(stepRow('Connect Aeon to Claude').dataset.tick).toBe('todo')
    expect(stepRow('Turn on Kairos’s brain').dataset.tick).toBe('todo')
    expect(screen.getByRole('link', { name: /Add to Claude/ })).toBeTruthy()
  })

  it('ticks connect from the connector signal', () => {
    renderList(status({}, { connectorUsedAt: '2026-10-01T20:00:00.000Z' }))
    expect(stepRow('Connect Aeon to Claude').dataset.tick).toBe('done')
    expect(screen.getByText('1 of 2 required done')).toBeTruthy()
  })

  it('treats missing signals as unknown — no tick, no error', () => {
    renderList(status({}, null))
    expect(stepRow('Connect Aeon to Claude').dataset.tick).toBe('unknown')
    expect(within(stepRow('Connect Aeon to Claude')).queryByText('Not yet')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the calm done state once both required steps are green', () => {
    const s = status(LIVE_BRAIN, { connectorUsedAt: '2026-10-01T20:00:00.000Z' })
    renderList(s)
    expect(screen.getByText(/Kairos is set up — he thinks every night on your Max plan/)).toBeTruthy()
    expect(screen.queryByText(/required done/)).toBeNull()
    expect(requiredMissing(s)).toBe(0)
  })

  it('a live brain routine implies the connector works', () => {
    renderList(status(LIVE_BRAIN, null))
    expect(stepRow('Connect Aeon to Claude').dataset.tick).toBe('done')
  })

  it('Add to Claude opens the pre-filled install link in a new tab', () => {
    renderList(status())
    const link = screen.getByRole('link', { name: /Add to Claude/ })
    expect(link.getAttribute('href')).toBe(claudeConnectorInstallUrl('https://aeon.example/api/mcp'))
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('“Or add it by hand” copies the name and URL', () => {
    renderList(status())
    fireEvent.click(screen.getByRole('button', { name: /Or add it by hand/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
    expect(writeText).toHaveBeenCalledWith('https://aeon.example/api/mcp')
    fireEvent.click(screen.getByRole('button', { name: 'Copy Name' }))
    expect(writeText).toHaveBeenCalledWith('aeon')
  })

  it('brain step links to routines and copies the prompt, name and model', () => {
    const brain = getRoutine('brain')
    renderList(status({}, { connectorUsedAt: '2026-10-01T20:00:00.000Z' }))
    expect(screen.getByRole('link', { name: /Open routines/ }).getAttribute('href')).toBe(CLAUDE_ROUTINES_URL)
    expect(screen.getByText(/remove every connector except/)).toBeTruthy()
    expect(screen.getByText(/Run now/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
    expect(writeText).toHaveBeenCalledWith(routinePrompt(brain))
    const copies = screen.getAllByRole('button', { name: 'Copy' })
    copies.forEach((b) => fireEvent.click(b))
    expect(writeText).toHaveBeenCalledWith(brain.name)
    expect(writeText).toHaveBeenCalledWith(brain.model)
  })

  it('keeps the web form vs /schedule choice inside the brain step', () => {
    renderList(status({}, { connectorUsedAt: '2026-10-01T20:00:00.000Z' }))
    fireEvent.click(screen.getByRole('tab', { name: /In Claude Code/ }))
    expect(screen.getByRole('button', { name: /Copy \/schedule request/ })).toBeTruthy()
  })

  it('old-routine clean-up is owner-only and remembers the manual tick', () => {
    const { unmount } = renderList(status())
    expect(screen.queryByText('Remove old routines')).toBeNull()
    unmount()
    renderList(status({ isAdmin: true }))
    fireEvent.click(screen.getByRole('button', { name: /Remove old routines/ }))
    expect(screen.getByText('kairos-brain-tick')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /I’ve deleted them/ }))
    expect(window.localStorage.getItem('kairos-setup-retired-cleared')).toBe('1')
    expect(stepRow('Remove old routines').dataset.tick).toBe('done')
  })
})

describe('SetupChecklist — optional steps', () => {
  it('is collapsed by default and hides owner steps from everyone else', () => {
    renderList(status())
    expect(screen.queryByText('Watched boards')).toBeNull()
    openOptional()
    expect(screen.getByText('Watched boards')).toBeTruthy()
    expect(screen.getByText('Voice notes from your phone')).toBeTruthy()
    expect(screen.getByText('Capture your coding sessions')).toBeTruthy()
    expect(screen.queryByText('Chat on Max')).toBeNull()
    expect(screen.queryByText('Telegram bot')).toBeNull()
    expect(screen.getByText('0 of 3 on')).toBeTruthy()
  })

  it('ticks optional steps from their signals', () => {
    renderList(status({}, { watchedBoards: 2, voiceNoteAt: '2026-10-01T09:00:00.000Z', sessions: { claude: '2026-10-02T06:00:00.000Z', codex: null, copilot: null } }))
    openOptional()
    expect(screen.getByText('3 of 3 on')).toBeTruthy()
    expect(stepRow('Watched boards').dataset.tick).toBe('done')
    expect(stepRow('Voice notes from your phone').dataset.tick).toBe('done')
    expect(stepRow('Capture your coding sessions').dataset.tick).toBe('done')
  })

  it('Watched step jumps to the Watched tab', () => {
    const onOpenWatched = vi.fn()
    renderList(status(), onOpenWatched)
    openOptional()
    fireEvent.click(screen.getByRole('button', { name: /Watched boards/ }))
    fireEvent.click(screen.getByRole('button', { name: /Open Watched/ }))
    expect(onOpenWatched).toHaveBeenCalled()
  })

  it('voice notes copy the exact claude.ai Project instruction', () => {
    renderList(status())
    openOptional()
    fireEvent.click(screen.getByRole('button', { name: /Voice notes from your phone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Copy instruction/ }))
    expect(writeText).toHaveBeenCalledWith(VOICE_NOTE_PROJECT_INSTRUCTION)
    expect(VOICE_NOTE_PROJECT_INSTRUCTION).toContain('kairos_voice_note')
  })

  it('session capture pre-fills AEON_BASE_URL and shows per-tool state', () => {
    renderList(status({}, { sessions: { claude: null, codex: '2026-10-02T05:00:00.000Z', copilot: null } }))
    openOptional()
    fireEvent.click(screen.getByRole('button', { name: /Capture your coding sessions/ }))
    expect(screen.getByText(/AEON_BASE_URL=https:\/\/aeon\.example/)).toBeTruthy()
    expect(screen.getByText('No session saved yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Codex/ }))
    expect(screen.getByText('Last session saved 2 h ago')).toBeTruthy()
    expect(screen.getByText(/codex-session-capture-dispatch\.mjs/)).toBeTruthy()
  })

  it('owner sees Chat on Max and Telegram; Send test calls the action', async () => {
    vi.mocked(sendKairosTestMessage).mockResolvedValue({ ok: true })
    renderList(status({ isAdmin: true }, { telegramConfigured: true }))
    openOptional()
    expect(screen.getByText('Chat on Max')).toBeTruthy()
    expect(stepRow('Telegram bot').dataset.tick).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: /Telegram bot/ }))
    expect(screen.getByText(/url=https%3A%2F%2Faeon\.example%2Fapi%2Ftelegram%2Fwebhook/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Send test message/ }))
    expect(sendKairosTestMessage).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Sent — check Telegram/)).toBeTruthy()
  })

  it('Send test shows the server’s reason when it fails', async () => {
    vi.mocked(sendKairosTestMessage).mockResolvedValue({ ok: false, error: 'Telegram is not configured' })
    renderList(status({ isAdmin: true }))
    openOptional()
    fireEvent.click(screen.getByRole('button', { name: /Telegram bot/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send test message/ }))
    expect(await screen.findByText('Telegram is not configured')).toBeTruthy()
  })

  it('Chat on Max ticks when the chat routine is live', () => {
    renderList(status({ isAdmin: true, routines: [
      { id: 'brain', lastClaimAt: null, state: 'silent' },
      { id: 'chat', lastClaimAt: '2026-10-02T06:00:00.000Z', state: 'live' },
    ] }))
    openOptional()
    expect(stepRow('Chat on Max').dataset.tick).toBe('done')
  })
})
