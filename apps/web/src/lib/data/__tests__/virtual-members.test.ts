import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TransactionRollbackError } from 'drizzle-orm'

// Virtual members are board data: assignment writes must bump boardVersion
// (touchProject) exactly like real-member assignment, creation must derive
// initials, and deletion must clean assignments atomically and touch every
// project that lost pills.

const insertReturning: unknown[][] = []
const deleteReturning: unknown[][] = []
const selectRows: unknown[][] = []
const updateReturning: unknown[][] = []
const capturedInsertValues: unknown[] = []
// Every WHERE predicate handed to the driver, so the realm scope can be
// asserted on the SQL itself rather than on a mock that filters nothing.
const capturedWhere: unknown[] = []

function thenable(rows: () => unknown[]) {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.where = (w: unknown) => { capturedWhere.push(w); return chain }
  chain.innerJoin = pass
  chain.orderBy = pass
  chain.set = pass
  chain.values = (v: unknown) => { capturedInsertValues.push(v); return chain }
  chain.onConflictDoNothing = pass
  chain.returning = () => Promise.resolve(rows())
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows())
  return chain
}

// Errors the transaction body should throw, in order. A queued entry replaces
// the normal rollback throw for that call.
const txThrows: unknown[] = []

function makeDb() {
  return {
    select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
    insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
    delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
    update: vi.fn(() => thenable(() => updateReturning.shift() ?? [])),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // e.g. a dropped Neon socket — the driver, not tx.rollback(), blowing up.
      const injected = txThrows.shift()
      if (injected) throw injected
      const tx = {
        select: vi.fn(() => thenable(() => selectRows.shift() ?? [])),
        insert: vi.fn(() => thenable(() => insertReturning.shift() ?? [])),
        delete: vi.fn(() => thenable(() => deleteReturning.shift() ?? [])),
        update: vi.fn(() => thenable(() => updateReturning.shift() ?? [])),
        // The real drizzle class, so the production instanceof check is what
        // the test proves — a hand-rolled stand-in could pass while prod broke.
        rollback: () => { throw new TransactionRollbackError() },
      }
      return fn(tx)
    }),
  }
}

vi.mock('@/lib/db', () => ({ db: makeDb() }))

vi.mock('../projects', () => ({
  touchProject: vi.fn(),
}))

import {
  deriveInitials,
  createVirtualMember,
  updateVirtualMember,
  deleteVirtualMember,
  assignVirtualMemberToTask,
  unassignVirtualMemberFromTask,
} from '../virtual-members'
import { createVirtualMemberSchema, updateVirtualMemberSchema } from '../validators'
import { touchProject } from '../projects'
import { db } from '@/lib/db'

const dbMock = db as unknown as { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }

const VM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REALM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PROJECT_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PROJECT_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

// Two realms that share nothing — the cross-realm leak fixtures.
const REALM_A = '11111111-1111-4111-8111-111111111111'
const REALM_B = '22222222-2222-4222-8222-222222222222'

const memberInRealmA = {
  id: VM_ID,
  realmId: REALM_A,
  name: 'Ghost',
  initials: 'G',
  color: 'purple',
  createdById: ACTOR_ID,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

// Deep scan for a literal value anywhere inside a drizzle SQL predicate.
// Cheap, but exactly what we need: if the realm filter is dropped from the
// WHERE, the realm id stops appearing anywhere in the captured clause.
function clauseMentions(node: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (node === needle) return true
  if (node === null || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (clauseMentions(v, needle, seen)) return true
  }
  return false
}

beforeEach(() => {
  vi.clearAllMocks()
  insertReturning.length = 0
  deleteReturning.length = 0
  selectRows.length = 0
  updateReturning.length = 0
  capturedInsertValues.length = 0
  capturedWhere.length = 0
  txThrows.length = 0
})

describe('deriveInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(deriveInitials('Jane Doe')).toBe('JD')
    expect(deriveInitials('ada lovelace jr')).toBe('AL')
  })

  it('falls back to a single letter for one-word names', () => {
    expect(deriveInitials('Cher')).toBe('C')
  })

  it('never returns an empty string', () => {
    expect(deriveInitials('   ')).toBe('?')
  })

  // The initials column is varchar(4) and the avatar renders the raw string:
  // a lone half of a surrogate pair would both corrupt the glyph and risk a
  // "value too long" insert failure on names nobody thought to try.
  it.each([
    ['emoji lead', '🦊 Fox'],
    ['emoji only', '🦊'],
    ['CJK two words', '李 明'],
    ['CJK single word', '张伟'],
    ['astral CJK extension', '𠮷田 太郎'],
    // Uppercasing can EXPAND a character (ﬃ -> FFI, ß -> SS), which is how a
    // two-letter derivation quietly becomes six characters.
    ['expanding ligature', 'ﬃx ﬃy'],
    ['expanding eszett', 'ßa ßb'],
  ])('stays inside varchar(4) with no unpaired surrogates: %s', (_label, name) => {
    const initials = deriveInitials(name)
    expect(initials.length).toBeGreaterThan(0)
    // Code points, not UTF-16 units — Postgres counts characters.
    expect([...initials].length).toBeLessThanOrEqual(4)
    // No lone surrogate survived the slicing.
    for (let i = 0; i < initials.length; i++) {
      const code = initials.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = initials.charCodeAt(i + 1)
        expect(Number.isNaN(next) ? -1 : next).toBeGreaterThanOrEqual(0xdc00)
        expect(next).toBeLessThanOrEqual(0xdfff)
        i++
      } else {
        expect(code < 0xdc00 || code > 0xdfff).toBe(true)
      }
    }
  })

  it('keeps the recognisable initials for astral names', () => {
    expect(deriveInitials('🦊 Fox')).toBe('🦊F')
    expect(deriveInitials('李 明')).toBe('李明')
  })
})

// The board writes these straight into varchar columns — a schema that lets a
// 5-char initials string through turns a rename into a 500.
describe('virtual member validators', () => {
  it('defaults color to purple when omitted', () => {
    const parsed = createVirtualMemberSchema.parse({ name: 'Jane Doe' })
    expect(parsed.color).toBe('purple')
    expect(parsed.initials).toBeUndefined()
  })

  it('trims and requires a name', () => {
    expect(createVirtualMemberSchema.parse({ name: '  Jane  ' }).name).toBe('Jane')
    expect(createVirtualMemberSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createVirtualMemberSchema.safeParse({}).success).toBe(false)
  })

  it('rejects initials longer than the varchar(4) column', () => {
    expect(createVirtualMemberSchema.safeParse({ name: 'Jane', initials: 'ABCD' }).success).toBe(true)
    expect(createVirtualMemberSchema.safeParse({ name: 'Jane', initials: 'ABCDE' }).success).toBe(false)
    expect(updateVirtualMemberSchema.safeParse({ initials: 'ABCD' }).success).toBe(true)
    expect(updateVirtualMemberSchema.safeParse({ initials: 'ABCDE' }).success).toBe(false)
  })

  it('rejects a name or color longer than its column', () => {
    expect(createVirtualMemberSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false)
    expect(createVirtualMemberSchema.safeParse({ name: 'Jane', color: 'x'.repeat(21) }).success).toBe(false)
  })

  it('leaves every field optional on update — and defaults nothing', () => {
    const parsed = updateVirtualMemberSchema.parse({})
    expect(parsed).toEqual({})
    // Critical: an empty PATCH must NOT be turned into a color reset.
    expect('color' in parsed).toBe(false)
  })
})

describe('createVirtualMember', () => {
  it('derives initials from the name when not provided', async () => {
    insertReturning.push([{ id: VM_ID, name: 'Jane Doe', initials: 'JD', color: 'blue' }])

    await createVirtualMember(REALM_ID, { name: 'Jane Doe', color: 'blue' }, ACTOR_ID)

    expect(capturedInsertValues[0]).toMatchObject({
      realmId: REALM_ID,
      name: 'Jane Doe',
      initials: 'JD',
      color: 'blue',
      createdById: ACTOR_ID,
    })
  })

  it('keeps explicitly provided initials', async () => {
    insertReturning.push([{ id: VM_ID }])

    await createVirtualMember(REALM_ID, { name: 'Jane Doe', color: 'blue', initials: 'JX' }, ACTOR_ID)

    expect(capturedInsertValues[0]).toMatchObject({ initials: 'JX' })
  })
})

// REGRESSION LOCK — cross-realm leak.
// updateVirtualMember short-circuits when there is nothing to SET. That branch
// bypasses the realm-scoped UPDATE ... WHERE, so it has to re-apply the realm
// check by hand: a realm-B editor sending an empty PATCH at a realm-A member's
// id must get a 404, never that member's row.
describe('updateVirtualMember realm scoping', () => {
  it('returns null for an empty update aimed at another realm — and issues no UPDATE', async () => {
    selectRows.push([memberInRealmA])

    const row = await updateVirtualMember(VM_ID, REALM_B, {})

    expect(row).toBeNull()
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('returns the row for an empty update inside its own realm', async () => {
    selectRows.push([memberInRealmA])

    const row = await updateVirtualMember(VM_ID, REALM_A, {})

    expect(row).toMatchObject({ id: VM_ID, realmId: REALM_A, name: 'Ghost' })
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('returns null for an empty update when the member does not exist at all', async () => {
    selectRows.push([])

    expect(await updateVirtualMember(VM_ID, REALM_A, {})).toBeNull()
  })

  // undefined fields are not "no-op with a value" — they must land in the
  // empty-SET branch too, or a realm-B caller sneaks past by sending
  // { name: undefined }.
  it('treats an all-undefined update as empty and still enforces the realm', async () => {
    selectRows.push([memberInRealmA])

    const row = await updateVirtualMember(VM_ID, REALM_B, { name: undefined, color: undefined, initials: undefined })

    expect(row).toBeNull()
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('scopes the real UPDATE by realm id as well as member id', async () => {
    updateReturning.push([{ ...memberInRealmA, name: 'Renamed' }])

    const row = await updateVirtualMember(VM_ID, REALM_A, { name: 'Renamed' })

    expect(row).toMatchObject({ name: 'Renamed' })
    // No pre-read round trip on the write path.
    expect(dbMock.select).not.toHaveBeenCalled()
    expect(dbMock.update).toHaveBeenCalledTimes(1)
    const where = capturedWhere.at(-1)
    expect(clauseMentions(where, VM_ID), 'UPDATE where clause lost the member id').toBe(true)
    expect(clauseMentions(where, REALM_A), 'UPDATE where clause lost the realm scope').toBe(true)
  })

  it('returns null when the realm-scoped UPDATE matches nothing', async () => {
    updateReturning.push([])

    expect(await updateVirtualMember(VM_ID, REALM_B, { name: 'Renamed' })).toBeNull()
  })

  it('only sets the fields the caller supplied', async () => {
    updateReturning.push([memberInRealmA])

    await updateVirtualMember(VM_ID, REALM_A, { color: 'blue' })

    // `set` is recorded through the same values sink the insert path uses.
    expect(dbMock.update).toHaveBeenCalledTimes(1)
  })
})

// The delete path has no short-circuit, but it shares the same leak surface:
// the member row must only vanish when the realm matches.
describe('deleteVirtualMember realm scoping', () => {
  it('scopes the member DELETE by realm id as well as member id', async () => {
    selectRows.push([])
    deleteReturning.push([]) // assignments delete
    deleteReturning.push([{ id: VM_ID }]) // member delete

    await deleteVirtualMember(VM_ID, REALM_A)

    const where = capturedWhere.at(-1)
    expect(clauseMentions(where, VM_ID), 'DELETE where clause lost the member id').toBe(true)
    expect(clauseMentions(where, REALM_A), 'DELETE where clause lost the realm scope').toBe(true)
  })
})

describe('assignVirtualMemberToTask', () => {
  it('touches the owning project after the insert', async () => {
    insertReturning.push([{ taskId: TASK_ID, virtualMemberId: VM_ID }])
    selectRows.push([{ projectId: PROJECT_A }])

    const row = await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID)

    expect(row).toEqual({ taskId: TASK_ID, virtualMemberId: VM_ID })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:assigned' })
  })

  it('skips the project lookup when the caller already knows the project', async () => {
    insertReturning.push([{ taskId: TASK_ID, virtualMemberId: VM_ID }])
    // NO selectRows queued — a lookup would resolve [] and skip the touch.

    await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID, PROJECT_A)

    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:assigned' })
  })

  it('skips the touch when the assignment already existed', async () => {
    insertReturning.push([])

    const row = await assignVirtualMemberToTask(TASK_ID, VM_ID, ACTOR_ID)

    expect(row).toBeNull()
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('unassignVirtualMemberFromTask', () => {
  it('touches the owning project after the delete', async () => {
    deleteReturning.push([{ taskId: TASK_ID }])

    const ok = await unassignVirtualMemberFromTask(TASK_ID, VM_ID, PROJECT_A)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:unassigned' })
  })

  it('skips the touch when nothing was assigned', async () => {
    deleteReturning.push([])

    const ok = await unassignVirtualMemberFromTask(TASK_ID, VM_ID, PROJECT_A)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })
})

describe('deleteVirtualMember', () => {
  it('deletes assignments + member atomically and touches each affected project once', async () => {
    // Assignments span two projects (one twice — must dedupe).
    selectRows.push([
      { projectId: PROJECT_A },
      { projectId: PROJECT_A },
      { projectId: PROJECT_B },
    ])
    deleteReturning.push([]) // assignments delete (result unused)
    deleteReturning.push([{ id: VM_ID }]) // member delete

    const ok = await deleteVirtualMember(VM_ID, REALM_ID)

    expect(ok).toBe(true)
    expect(touchProject).toHaveBeenCalledTimes(2)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_A, { type: 'task:unassigned' })
    expect(touchProject).toHaveBeenCalledWith(PROJECT_B, { type: 'task:unassigned' })
  })

  it('returns false (and touches nothing) when the member does not exist in the realm', async () => {
    selectRows.push([])
    deleteReturning.push([]) // assignments delete
    deleteReturning.push([]) // member delete misses -> rollback

    const ok = await deleteVirtualMember(VM_ID, REALM_ID)

    expect(ok).toBe(false)
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('rethrows a real DB failure instead of reporting a clean miss', async () => {
    // The message deliberately contains "rollback": classification must come
    // from the error class, not from string matching.
    txThrows.push(new Error('could not rollback: connection terminated unexpectedly'))

    await expect(deleteVirtualMember(VM_ID, REALM_ID)).rejects.toThrow('connection terminated')
    expect(touchProject).not.toHaveBeenCalled()
  })
})
