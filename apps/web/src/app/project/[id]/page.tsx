import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { findProjectBasic } from '@/lib/data/projects'
import ProjectContent from './ProjectContent'
import { AccessDenied } from './AccessDenied'

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

  if (!project) {
    const exists = await findProjectBasic(id)
    return <AccessDenied projectName={exists?.name} />
  }

  return (
    <ProjectContent
      project={project}
      user={{
        id: session.user.id,
        role: session.user.role ?? 'user',
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    />
  )
}
