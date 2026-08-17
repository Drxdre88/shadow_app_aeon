import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FALLBACK } = vi.hoisted(() => ({
  FALLBACK: { businessMode: true, celebrationStyle: 'checkmark-pulse' } as Record<string, unknown>,
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/data/settingsTemplates', () => ({
  BUSINESS_ADMIN_TEMPLATE: 'business_admin',
  BUSINESS_ADMIN_FALLBACK: FALLBACK,
  findTemplate: vi.fn(),
  upsertTemplate: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { findTemplate, upsertTemplate } from '@/lib/data/settingsTemplates'
import { getSettingsTemplate, saveSettingsTemplate } from '../settingsTemplates'

const mockAuth = vi.mocked(auth)
const mockFind = vi.mocked(findTemplate)
const mockUpsert = vi.mocked(upsertTemplate)

function session(role: string | null, id: string | null = 'user-1') {
  if (!id) return null
  return { user: { id, role } } as unknown as Awaited<ReturnType<typeof auth>>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('settings template actions — admin gate', () => {
  it('rejects anonymous callers', async () => {
    mockAuth.mockResolvedValue(null as never)
    await expect(getSettingsTemplate()).rejects.toThrow('Unauthorized')
    await expect(saveSettingsTemplate('business_admin', {})).rejects.toThrow('Unauthorized')
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects signed-in non-admins', async () => {
    mockAuth.mockResolvedValue(session('user') as never)
    await expect(getSettingsTemplate()).rejects.toThrow('Admin access required')
    await expect(saveSettingsTemplate('business_admin', { glowIntensity: 20 })).rejects.toThrow('Admin access required')
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('getSettingsTemplate', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(session('admin', 'admin-1') as never)
  })

  it('returns the stored template', async () => {
    const updatedAt = new Date('2026-08-17T00:00:00.000Z')
    mockFind.mockResolvedValue({ preferences: { glowIntensity: 5 }, updatedAt } as never)
    await expect(getSettingsTemplate()).resolves.toEqual({
      name: 'business_admin',
      exists: true,
      preferences: { glowIntensity: 5 },
      updatedAt,
    })
    expect(mockFind).toHaveBeenCalledWith('business_admin')
  })

  it('returns the fallback when no row exists', async () => {
    mockFind.mockResolvedValue(null as never)
    await expect(getSettingsTemplate()).resolves.toEqual({
      name: 'business_admin',
      exists: false,
      preferences: FALLBACK,
      updatedAt: null,
    })
  })
})

describe('saveSettingsTemplate', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(session('admin', 'admin-1') as never)
  })

  it('persists the template with the admin as author', async () => {
    await expect(saveSettingsTemplate('  business_admin  ', { glowIntensity: 20 })).resolves.toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalledWith('business_admin', { glowIntensity: 20 }, 'admin-1')
  })

  it('rejects an empty name', async () => {
    await expect(saveSettingsTemplate('   ', {})).rejects.toThrow('Template name must be 1-50 characters')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects non-object preferences', async () => {
    await expect(saveSettingsTemplate('business_admin', [] as unknown as Record<string, unknown>)).rejects.toThrow(
      'Template preferences must be an object'
    )
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
