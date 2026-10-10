// Total Recall step 2a backfill: seed the owner's entity map and rescan every
// memory for fk/dict mentions. Idempotent; prints counts only.
//
//   npx tsx scripts/entity-backfill.ts [--user <uuid>] [--seed-only]
//
// The user defaults to the first VORATH_USER_IDS entry, then KAIROS_OPERATOR_USER_ID.

import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function ownerId(): string {
  const explicit = argValue('--user')?.trim()
  const fromEnv = (process.env.VORATH_USER_IDS ?? '').split(',')[0]?.trim() || process.env.KAIROS_OPERATOR_USER_ID?.trim()
  const id = explicit || fromEnv
  if (!id) throw new Error('No user: pass --user <uuid> or set VORATH_USER_IDS')
  return id
}

async function main(): Promise<void> {
  const userId = ownerId()
  const { seedEntities } = await import('../src/lib/data/entities/seed')
  const { rescanMemories } = await import('../src/lib/data/entities/scan')
  const { entityMapCounts } = await import('../src/lib/data/entities/queries')

  const seeded = await seedEntities(userId)
  console.log(JSON.stringify({ step: 'seed', plannedEntities: seeded.entities, newAliases: seeded.aliases }))
  if (!process.argv.includes('--seed-only')) {
    const scan = await rescanMemories(userId)
    console.log(JSON.stringify({ step: 'scan', ...scan }))
  }
  console.log(JSON.stringify({ step: 'totals', ...(await entityMapCounts(userId)) }, null, 2))
}

main()
  .then(() => { process.exitCode = 0 })
  .catch((err: unknown) => {
    console.error('entity-backfill failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
