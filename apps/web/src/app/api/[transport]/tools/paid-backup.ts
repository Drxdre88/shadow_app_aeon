import { getPaidBackupSetting, setPaidBackupSetting } from '@/lib/data/kairos-paid-backup'
import { setKairosPaidBackupSchema } from '@/lib/data/validators/kairos-paid-backup'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos "Paid backup" switch. On (default): when the Max-plan routine misses
// a thinking job, Kairos covers it with the user's own API key. Off: Kairos
// never spends that key — a missed job waits for the next run and the 06:00
// message falls back to plain text. Shares validator + data fns with
// /api/v1/kairos/paid-backup (kairos-paid-backup-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerPaidBackupTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_paid_backup',
    'Read the Vorath "Paid backup" switch: whether Vorath may spend your own API key when the Claude Max routine misses a thinking job (default on).',
    {},
    { title: 'Get Vorath Paid Backup', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (_args, extra) => {
      const uid = getUserId(extra)
      return ok({ enabled: await getPaidBackupSetting(uid) })
    }
  )

  server.tool(
    'set_kairos_paid_backup',
    'Turn the Vorath "Paid backup" on or off. On: a job the Max routine missed is covered with your API key. Off: Vorath never uses your API key — a missed job waits for the next run and the 06:00 message falls back to plain text.',
    { enabled: setKairosPaidBackupSchema.shape.enabled.describe('true = allow the paid API-key backup, false = never use it') },
    { title: 'Set Vorath Paid Backup', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = setKairosPaidBackupSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      return ok({ enabled: await setPaidBackupSetting(uid, parsed.data.enabled) })
    }
  )
}
