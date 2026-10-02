import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { getPaidBackupSetting, setPaidBackupSetting } from '@/lib/data/kairos-paid-backup'
import { setKairosPaidBackupSchema } from '@/lib/data/validators/kairos-paid-backup'

// Kairos "Paid backup" switch. Mirrors the get_kairos_paid_backup /
// set_kairos_paid_backup MCP tools through the same validator + data fns
// (kairos-paid-backup-parity.test.ts enforces this).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    return jsonData({ enabled: await getPaidBackupSetting(result.id) })
  }),
  API_READ_LIMIT
)

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const body = await request.json().catch(() => null)
    const parsed = setKairosPaidBackupSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    return jsonData({ enabled: await setPaidBackupSetting(result.id, parsed.data.enabled) })
  }),
  API_WRITE_LIMIT
)
