import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { verifyProjectOwnership } from '@/lib/data/projects'
import ProjectContent from './ProjectContent'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await auth()
  if (!session?.user) return {}

  const { id } = await params
  const project = await verifyProjectOwnership(id, session.user.id)

  return { title: project?.name ?? 'Project' }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const { id } = await params
  const project = await verifyProjectOwnership(id, session.user.id)

  if (!project) notFound()

  return <ProjectContent project={project} />
}
