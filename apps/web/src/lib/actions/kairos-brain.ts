'use server'

import { headers } from 'next/headers'
import { MIND_NAME } from '@/lib/kairos/identity'
import { auth } from '@/lib/auth'
import { listBrainJobsSince, summariseBrainStatus, summariseChatLatency, countPaidBackupCalls, getSetupSignals, BRAIN_STATUS_WINDOW_MS } from '@/lib/data/brain-status'
import { checkRateLimit } from '@/lib/api/rateLimit'
import { sendMessage, telegramConfigured } from '@/lib/kairos/telegram'
import { getPaidBackupSetting, setPaidBackupSetting } from '@/lib/data/kairos-paid-backup'
import { listCharacterRuns } from '@/lib/data/character'
import { summariseCharacterRuns } from '@/lib/kairos/character/rubric'
import { listColdReads } from '@/lib/data/cold-reads'
import { summariseColdReads } from '@/lib/kairos/cold-read/compare'
import { coldReadEnabled } from '@/lib/kairos/cold-read/flag'
import { setKairosPaidBackupSchema } from '@/lib/data/validators/kairos-paid-backup'
import { getBaseUrl } from '@/lib/email'
import { chatRoutineConfig, telegramRoutineEnabled } from '@/lib/kairos/chat-routine'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { findOwnProjects } from '@/lib/data/projects'
import { findDominionsByUser, listReposForUser, listRecentCaptureRepos } from '@/lib/data/dominions'
import { parseKairosFeed, type KairosFeedMode } from '@/lib/kairos/board-feed-render'
import { requireVorath } from './helpers'

export interface KairosWatchedOverview {
  projects: Array<{ id: string; name: string; feed: KairosFeedMode | null; areaName: string | null }>
  areas: Array<{ id: string; name: string; color: string; repos: string[] }>
  unmappedRepos: Array<{ repo: string; captures: number; lastAt: string }>
}

const UNMAPPED_WINDOW_MS = 14 * 86_400_000

// The boards Kairos watches (settings.kairosFeed on boards you own — the
// nightly feed only runs for the owner), each area's core repos, and repos
// recent captures named that resolve to no area.
export async function getKairosWatchedOverview(): Promise<KairosWatchedOverview> {
  const userId = await requireVorath()
  const [ownProjects, areas, repoRows, recent] = await Promise.all([
    findOwnProjects(userId),
    findDominionsByUser(userId),
    listReposForUser(userId),
    listRecentCaptureRepos(userId, new Date(Date.now() - UNMAPPED_WINDOW_MS)),
  ])
  const liveAreas = areas.filter((area) => !area.archivedAt)
  const areaName = new Map(areas.map((area) => [area.id, area.name]))
  const mapped = new Set(repoRows.map((row) => row.repoSlug))
  return {
    projects: ownProjects
      .map((p) => ({ id: p.id, name: p.name, feed: parseKairosFeed(p.settings), areaName: p.dominionId ? areaName.get(p.dominionId) ?? null : null }))
      .sort((a, b) => Number(!!b.feed) - Number(!!a.feed) || a.name.localeCompare(b.name)),
    areas: liveAreas.map((area) => ({
      id: area.id,
      name: area.name,
      color: area.color,
      repos: repoRows.filter((row) => row.dominionId === area.id).map((row) => row.repoSlug),
    })),
    unmappedRepos: recent
      .filter((row) => !mapped.has(row.repo))
      .map((row) => ({ repo: row.repo, captures: row.captures, lastAt: row.lastAt.toISOString() })),
  }
}

// The app's public origin: the configured auth/app URL, else the request's
// own host (preview deployments without the env set).
async function resolveAppUrl(): Promise<string> {
  const configured = getBaseUrl()?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const proto = h.get('x-forwarded-proto')
    || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return host ? `${proto}://${host}` : ''
}

export async function getKairosBrainStatus(): Promise<KairosBrainStatus> {
  const userId = await requireVorath()
  const session = await auth()
  const now = new Date()
  const routineFlagOn = telegramRoutineEnabled()
  const isAdmin = session?.user?.role === 'admin'

  const [rows, appUrl, paidBackupEnabled, setup, characterRuns, coldReadRows] = await Promise.all([
    listBrainJobsSince(userId, new Date(now.getTime() - BRAIN_STATUS_WINDOW_MS)),
    resolveAppUrl(),
    getPaidBackupSetting(userId),
    getSetupSignals(userId, { isOperator: isKairosOperator(userId, isAdmin), now }),
    // Health only; a failed read hides the row instead of the whole status.
    listCharacterRuns(userId, 4).catch((err) => {
      console.error('[kairos-brain] character runs read failed', err)
      return []
    }),
    coldReadEnabled()
      ? listColdReads(userId, { since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), limit: 100 }).catch((err) => {
          console.error('[kairos-brain] cold reads read failed', err)
          return null
        })
      : Promise.resolve(null),
  ])
  const classify = { paidBackupOff: !paidBackupEnabled }

  return {
    generatedAt: now.toISOString(),
    appUrl,
    mcpUrl: `${appUrl}/api/mcp`,
    ...summariseBrainStatus(rows, now, { chatRoutineFlagOn: routineFlagOn, ...classify }),
    telegram: { routineFlagOn, routineConfigured: chatRoutineConfig() !== null },
    isAdmin,
    paidBackup: { enabled: paidBackupEnabled, paidCallsLast7d: countPaidBackupCalls(rows, now, classify) },
    setup,
    chatLatency: summariseChatLatency(rows, now, classify),
    character: summariseCharacterRuns(characterRuns),
    coldReads: coldReadRows ? summariseColdReads(coldReadRows, now) : null,
  }
}

// The Telegram bot talks to one person: KAIROS_OPERATOR_USER_ID. Without it
// set (single-user dev), an admin stands in.
function isKairosOperator(userId: string, isAdmin: boolean): boolean {
  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID?.trim()
  return operatorUserId ? operatorUserId === userId : isAdmin
}

const KAIROS_TEST_MESSAGE = `${MIND_NAME} test — if you can read this, Telegram is connected ✓`
// A test button, not a speak: no inbox row, no reply gate, no cadence budget —
// so it gets its own small limit instead of the speak throttle.
const TEST_MESSAGE_LIMIT = { windowMs: 60_000, maxRequests: 3 }

// "Send a test message" in the Set up Kairos checklist. Plain sendMessage to
// the operator chat on purpose: deliverKairosSpeak would file an inbox item,
// spend the speak cadence and could arm awaiting-reply.
export async function sendKairosTestMessage(): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireVorath()
  const session = await auth()
  if (!isKairosOperator(userId, session?.user?.role === 'admin')) {
    return { ok: false, error: `Only the ${MIND_NAME} operator can send a Telegram test.` }
  }
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID
  if (!telegramConfigured() || !chatId) {
    return { ok: false, error: 'Telegram is not set up — TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_CHAT_ID are needed.' }
  }
  if (!checkRateLimit(`kairos-telegram-test:${userId}`, TEST_MESSAGE_LIMIT).allowed) {
    return { ok: false, error: 'Too many tests — wait a minute and try again.' }
  }
  try {
    await sendMessage(chatId, KAIROS_TEST_MESSAGE)
    return { ok: true }
  } catch (err) {
    console.error('[kairos-brain] telegram test failed', err)
    return { ok: false, error: 'Telegram did not accept the message — check the bot token and chat id.' }
  }
}

// Kairos "Paid backup" switch (per user). Off = Kairos never spends the user's
// own API key; a job the Max routine missed waits for the next run. Same
// validator + data fns as the MCP tools and /api/v1/kairos/paid-backup.
export async function getPaidBackup(): Promise<{ enabled: boolean }> {
  const userId = await requireVorath()
  return { enabled: await getPaidBackupSetting(userId) }
}

export async function setPaidBackup(enabled: boolean): Promise<{ enabled: boolean }> {
  const userId = await requireVorath()
  const parsed = setKairosPaidBackupSchema.parse({ enabled })
  return { enabled: await setPaidBackupSetting(userId, parsed.enabled) }
}
