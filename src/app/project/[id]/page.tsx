import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import ProjectContent from './ProjectContent'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await auth()
  if (!session?.user) return {}

  const { id } = await params
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))

  return { title: project?.name ?? 'Project' }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { id } = await params

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))

  if (!project) notFound()

  return <ProjectContent project={project} />
}
