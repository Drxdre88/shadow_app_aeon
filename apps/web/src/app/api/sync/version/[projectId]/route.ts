import { jsonResponse } from '@/lib/api/response'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = await params
    const project = await verifyProjectOwnership(projectId, session.user.id)

    if (!project) {
      return jsonResponse({ error: 'Not found' }, { status: 404 })
    }

    return jsonResponse({
      version: project.boardVersion,
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('[Sync Version Error]', error instanceof Error ? error.message : error)
    return jsonResponse({ error: 'Internal error' }, { status: 500 })
  }
}
