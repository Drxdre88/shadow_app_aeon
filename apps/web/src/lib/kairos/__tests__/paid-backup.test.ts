import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-paid-backup', () => ({ getPaidBackupSetting: vi.fn() }))
vi.mock('../cron-trace', () => ({ writeCronSuccessTrace: vi.fn() }))

import { getPaidBackupSetting } from '@/lib/data/kairos-paid-backup'
import { writeCronSuccessTrace } from '../cron-trace'
import { isPaidBackupEnabled } from '../paid-backup'
import { skipCronIfPaidBackupOff } from '../paid-backup-cron'

beforeEach(() => vi.clearAllMocks())

describe('isPaidBackupEnabled', () => {
  it('passes the stored per-user switch through', async () => {
    vi.mocked(getPaidBackupSetting).mockResolvedValueOnce(false)
    expect(await isPaidBackupEnabled('u1')).toBe(false)
    expect(getPaidBackupSetting).toHaveBeenCalledWith('u1')
  })
})

describe('skipCronIfPaidBackupOff', () => {
  it('on: lets the fallback cron run, no trace', async () => {
    vi.mocked(getPaidBackupSetting).mockResolvedValueOnce(true)
    expect(await skipCronIfPaidBackupOff('u1', 'cortex-regen')).toBe(false)
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('off: skips the user with a "paid backup off" trace', async () => {
    vi.mocked(getPaidBackupSetting).mockResolvedValueOnce(false)
    expect(await skipCronIfPaidBackupOff('u1', 'cortex-regen')).toBe(true)
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u1', { cronName: 'cortex-regen', outcome: 'skipped', skipReason: 'paid backup off' })
  })
})
