'use client'

import { useState } from 'react'
import { Eye, Users, FolderMinus, FolderPlus, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type GroupProjectRow = {
  projectId: string
  name: string
  planetImage: string | null
  ownerId: string
  visibility: string
}

type MemberRow = {
  userId: string
  name: string | null
  email: string
  image: string | null
}

type AccessMember = {
  userId: string
}

interface ProjectsTabProps {
  isOwner: boolean
  groupProjects: GroupProjectRow[]
  availableProjects: { id: string; name: string }[]
  realmMembers: MemberRow[]
  currentUserId: string
  onAddProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
  onSetVisibility: (projectId: string, visibility: 'all' | 'members_only') => void
  onUpdateAccessList: (projectId: string, userIds: string[]) => void
  projectAccessLists: Record<string, AccessMember[]>
  onLoadAccessList: (projectId: string) => void
}

const VISIBILITY_OPTIONS = [
  { value: 'all', label: 'All members', icon: Eye, color: 'text-slate-500' },
  { value: 'members_only', label: 'Selected members', icon: Users, color: 'text-amber-400' },
] as const

export function ProjectsTab({
  isOwner,
  groupProjects,
  availableProjects,
  realmMembers,
  currentUserId,
  onAddProject,
  onRemoveProject,
  onSetVisibility,
  onUpdateAccessList,
  projectAccessLists,
  onLoadAccessList,
}: ProjectsTabProps) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null)

  const handleVisibilityChange = (projectId: string, visibility: 'all' | 'members_only') => {
    onSetVisibility(projectId, visibility)
    if (visibility === 'members_only') {
      setExpandedProject(projectId)
      if (!projectAccessLists[projectId]) {
        onLoadAccessList(projectId)
      }
    } else {
      setExpandedProject(null)
    }
  }

  const handleToggleMember = (projectId: string, userId: string) => {
    const current = projectAccessLists[projectId] || []
    const currentIds = current.map((m) => m.userId)
    const updated = currentIds.includes(userId)
      ? currentIds.filter((id) => id !== userId)
      : [...currentIds, userId]
    onUpdateAccessList(projectId, updated)
  }

  const nonOwnerMembers = realmMembers.filter((m) => m.userId !== currentUserId)

  return (
    <>
      <div className="space-y-1">
        <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">In Realm</p>
        {groupProjects.length === 0 ? (
          <p className="text-xs text-slate-600 px-1 py-3">No projects added yet</p>
        ) : groupProjects.map((p) => {
          const isExpanded = expandedProject === p.projectId && p.visibility === 'members_only'
          const accessList = projectAccessLists[p.projectId] || []
          const accessUserIds = new Set(accessList.map((m) => m.userId))
          const visOption = VISIBILITY_OPTIONS.find((o) => o.value === p.visibility) || VISIBILITY_OPTIONS[0]
          const VisIcon = visOption.icon

          return (
            <div key={p.projectId}>
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors">
                <div className="flex items-center gap-3">
                  {p.planetImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/planets/${p.planetImage}`} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />
                  )}
                  <span className="text-sm text-white">{p.name}</span>
                  {p.visibility === 'members_only' && (
                    <span className="text-[10px] text-amber-400/70 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                      {accessList.length} selected
                    </span>
                  )}
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (p.visibility === 'members_only') {
                          if (isExpanded) {
                            setExpandedProject(null)
                          } else {
                            setExpandedProject(p.projectId)
                            if (!projectAccessLists[p.projectId]) onLoadAccessList(p.projectId)
                          }
                        } else {
                          handleVisibilityChange(p.projectId, 'members_only')
                        }
                      }}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        p.visibility === 'members_only'
                          ? 'text-amber-400 hover:bg-amber-500/10'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/10'
                      )}
                      title={p.visibility === 'members_only'
                        ? 'Selected members only — click to manage'
                        : 'Visible to all — click to restrict'}
                    >
                      <VisIcon className="w-3.5 h-3.5" />
                    </button>
                    {p.visibility === 'members_only' && (
                      <button
                        onClick={() => handleVisibilityChange(p.projectId, 'all')}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        title="Make visible to all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveProject(p.projectId)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <FolderMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {isOwner && isExpanded && (
                <div className="ml-9 mr-3 mb-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Select who can see this project</p>
                  {nonOwnerMembers.length === 0 ? (
                    <p className="text-xs text-slate-600">No other realm members to select</p>
                  ) : nonOwnerMembers.map((m) => {
                    const isSelected = accessUserIds.has(m.userId)
                    return (
                      <button
                        key={m.userId}
                        onClick={() => handleToggleMember(p.projectId, m.userId)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
                          isSelected
                            ? 'bg-amber-500/10 border border-amber-500/20'
                            : 'hover:bg-white/[0.04] border border-transparent'
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                          isSelected
                            ? 'bg-amber-500/30 border-amber-500/50'
                            : 'border-white/20'
                        )}>
                          {isSelected && <Check className="w-3 h-3 text-amber-400" />}
                        </div>
                        {m.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.image} alt="" className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-slate-400">
                            {(m.name || m.email)[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-white truncate block">{m.name || m.email}</span>
                          {m.name && <span className="text-[10px] text-slate-500 truncate block">{m.email}</span>}
                        </div>
                      </button>
                    )
                  })}
                  <p className="text-[10px] text-slate-600 mt-2">You (realm owner) always have access</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isOwner && availableProjects.length > 0 && (
        <div className="space-y-1 border-t border-white/10 pt-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">Add to Realm</p>
          {availableProjects.map((p) => (
            <button
              key={p.id}
              onClick={() => onAddProject(p.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.05] transition-colors text-left"
            >
              <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm text-slate-300">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
