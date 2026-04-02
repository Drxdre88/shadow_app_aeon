'use client'

import { Eye, EyeOff, FolderMinus, FolderPlus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type GroupProjectRow = {
  projectId: string
  name: string
  planetImage: string | null
  ownerId: string
  visibility: string
}

interface ProjectsTabProps {
  isOwner: boolean
  groupProjects: GroupProjectRow[]
  availableProjects: { id: string; name: string }[]
  onAddProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
  onToggleVisibility: (projectId: string, current: string) => void
}

export function ProjectsTab({
  isOwner,
  groupProjects,
  availableProjects,
  onAddProject,
  onRemoveProject,
  onToggleVisibility,
}: ProjectsTabProps) {
  return (
    <>
      <div className="space-y-1">
        <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">In Realm</p>
        {groupProjects.length === 0 ? (
          <p className="text-xs text-slate-600 px-1 py-3">No projects added yet</p>
        ) : groupProjects.map((p) => (
          <div key={p.projectId} className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors">
            <div className="flex items-center gap-3">
              {p.planetImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/planets/${p.planetImage}`} alt="" className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />
              )}
              <span className="text-sm text-white">{p.name}</span>
            </div>
            {isOwner && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggleVisibility(p.projectId, p.visibility)}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    p.visibility === 'owners_only'
                      ? 'text-amber-400 hover:bg-amber-500/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/10'
                  )}
                  title={p.visibility === 'owners_only' ? 'Owners only — click to make visible to all' : 'Visible to all — click to restrict to owners'}
                >
                  {p.visibility === 'owners_only'
                    ? <EyeOff className="w-3.5 h-3.5" />
                    : <Eye className="w-3.5 h-3.5" />
                  }
                </button>
                <button
                  onClick={() => onRemoveProject(p.projectId)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <FolderMinus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
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
