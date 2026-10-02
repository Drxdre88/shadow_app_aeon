'use server'

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { listBrainJobsSince, summariseBrainStatus, BRAIN_STATUS_WINDOW_MS } from '@/lib/data/brain-status'
import { getBaseUrl } from '@/lib/email'
import { chatRoutineConfig, telegramRoutineEnabled } from '@/lib/kairos/chat-routine'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { findOwnProjects } from '@/lib/data/projects'
import { findDominionsByUser, listReposForUser, listRecentCaptureRepos } from '@/lib/data/dominions'
import { parseKairosFeed, type KairosFeedMode } from '@/lib/kairos/board-feed-render'
import { requireAuth } from './helpers'

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
  const userId = await requireAuth()
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
  const userId = await requireAuth()
  const session = await auth()
  const now = new Date()
  const routineFlagOn = telegramRoutineEnabled()

  const [rows, appUrl] = await Promise.all([
    listBrainJobsSince(userId, new Date(now.getTime() - BRAIN_STATUS_WINDOW_MS)),
    resolveAppUrl(),
  ])

  return {
    generatedAt: now.toISOString(),
    appUrl,
    mcpUrl: `${appUrl}/api/mcp`,
    ...summariseBrainStatus(rows, now, { chatRoutineFlagOn: routineFlagOn }),
    telegram: { routineFlagOn, routineConfigured: chatRoutineConfig() !== null },
    isAdmin: session?.user?.role === 'admin',
  }
}
