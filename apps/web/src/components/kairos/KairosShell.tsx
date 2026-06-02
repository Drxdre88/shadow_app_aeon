'use client'

import { useMemo } from 'react'
import { signOut } from 'next-auth/react'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { useSidebarStore } from '@/stores/sidebarStore'
import { KairosVisor } from '@/components/kairos/KairosVisor'
import { KairosVisorToggle } from '@/components/kairos/KairosVisorToggle'

interface WorkspaceData {
  groupId: string
  groupName: string
  groupColor: string | null
  groupIcon: string | null
  isPersonal: boolean
  memberCount: number
  ownerId: string
  memberRole: string
  projects: Array<Record<string, unknown>>
}

interface DominionOption {
  id: string
  name: string
}

interface KairosShellProps {
  user: {
    id: string
    role: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  initialWorkspaces: WorkspaceData[]
  // Kairos Phase 2 (C1) — pre-fetched Dominion list for the chat Visor
  // anchor picker. Server-side fetch so the panel opens without latency.
  dominions: DominionOption[]
  children: React.ReactNode
}

export function KairosShell({ user, initialWorkspaces, dominions, children }: KairosShellProps) {
  const { collapsed, hiddenRealmIds, hiddenProjectIds } = useSidebarStore()

  const sidebarRealms = useMemo(
    () =>
      initialWorkspaces
        .filter((ws) => !ws.isPersonal && !hiddenRealmIds.includes(ws.groupId))
        .map((ws) => ({
          id: ws.groupId,
          name: ws.groupName,
          color: ws.groupColor ?? 'purple',
          icon: ws.groupIcon,
          isPersonal: ws.isPersonal,
          isOwner: ws.ownerId === user.id || ws.memberRole === 'owner',
          projectCount: ws.projects.filter(
            (p) => !hiddenProjectIds.includes(String(p.id)),
          ).length,
          memberCount: ws.memberCount,
        })),
    [initialWorkspaces, hiddenRealmIds, hiddenProjectIds, user.id],
  )

  return (
    <div className="h-screen flex overflow-hidden bg-black">
      <AppSidebar
        user={user}
        realms={sidebarRealms}
        onSignOut={() => signOut({ callbackUrl: '/' })}
      />
      <div
        className="flex-1 flex flex-col h-screen overflow-hidden transition-all duration-300"
        style={{ marginLeft: collapsed ? 60 : 260 }}
      >
        {children}
      </div>
      <KairosVisor dominions={dominions} />
      <KairosVisorToggle />
    </div>
  )
}
