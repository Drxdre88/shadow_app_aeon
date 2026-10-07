import { readCardForecasts } from '@/lib/data/card-forecast'
import { getCardForecastSchema } from '@/lib/data/validators/card-forecast'
import type { RegisterFn } from './types'
import { getUserId, ok, fail, notFound } from './types'

// Self-forecasting board (P3-2) — READ ONLY. A likely finish date for cards
// that already have a due date or an estimate, recomputed on every read from
// 30-day column dwell and the cached schedule. Never touches predictions.
// Mirrors GET /api/v1/projects/[id]/forecast (card-forecast-parity.test.ts).

export const registerCardForecastTools: RegisterFn = (server) => {
  server.tool(
    'get_card_forecast',
    'Likely finish date for open cards that already have a due date or an estimate: the later of the scheduled end and now plus how long cards recently sat (last 30 days) in each column left before Done. Each card gets a status (on_track / at_risk within 2 days of due / late / no_due_date), a confidence (low when fewer than 5 cards moved through those columns) and a plain-English reason. Optional taskId for one card. Read-only.',
    {
      projectId: getCardForecastSchema.shape.projectId.describe('Project (board) id'),
      taskId: getCardForecastSchema.shape.taskId.describe('Optional card id to forecast just that card'),
    },
    { title: 'Get Card Forecast', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getCardForecastSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const view = await readCardForecasts(parsed.data.projectId, uid, { taskId: parsed.data.taskId })
      if (!view) return notFound('Project')
      return ok(view)
    }
  )
}