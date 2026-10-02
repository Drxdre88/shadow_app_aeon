'use server'

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { listBrainJobsSince, summariseBrainStatus, BRAIN_STATUS_WINDOW_MS } from '@/lib/data/brain-status'
import { getBaseUrl } from '@/lib/email'
import { chatRoutineConfig, telegramRoutineEnabled } from '@/lib/kairos/chat-routine'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { requireAuth } from './helpers'

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
