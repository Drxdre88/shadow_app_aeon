import { z } from 'zod'

// Kairos "Paid backup" switch — one schema for the server action, the MCP
// tool set_kairos_paid_backup and PUT /api/v1/kairos/paid-backup
// (kairos-paid-backup-parity.test.ts locks this).
export const setKairosPaidBackupSchema = z.object({
  enabled: z.boolean(),
})

export type SetKairosPaidBackupInput = z.infer<typeof setKairosPaidBackupSchema>
