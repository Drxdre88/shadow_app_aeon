import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function findBoardVersion(projectId: string): Promise<number | null> {
  const [row] = await db
    .select({ boardVersion: projects.boardVersion })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return row?.boardVersion ?? null
}
