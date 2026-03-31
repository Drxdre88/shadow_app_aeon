import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { projects, projectMembers } from '@/lib/db/schema'
import { eq, and, or } from 'drizzle-orm'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId } = await params
  const userId = session.user.id

  const [row] = await db
    .select({ boardVersion: projects.boardVersion, updatedAt: projects.updatedAt })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(
      eq(projects.id, projectId),
      or(eq(projects.userId, userId), eq(projectMembers.userId, userId)),
    ))

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    version: row.boardVersion,
    updatedAt: row.updatedAt.toISOString(),
  })
}
