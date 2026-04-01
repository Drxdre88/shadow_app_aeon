'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Users, Trash2, Orbit, Check } from 'lucide-react'

export interface RealmInfo {
  id: string
  name: string
  color: string
  isPersonal: boolean
}

interface ProjectContextMenuProps {
  x: number
  y: number
  projectId: string
  projectName: string
  realms: RealmInfo[]
  projectRealmIds: string[]
  onClose: () => void
  onEdit: () => void
  onShare: () => void
  onDelete: () => void
  onToggleRealm: (realmId: string) => void
}

export function ProjectContextMenu({
  x, y, projectId, projectName, realms, projectRealmIds,
  onClose, onEdit, onShare, onDelete, onToggleRealm,
}: ProjectContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const inMenu = menuRef.current?.contains(e.target as Node)
      const inSub = subRef.current?.contains(e.target as Node)
      if (!inMenu && !inSub) onClose()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const clampedX = Math.min(x, window.innerWidth - 220)
  const clampedY = Math.min(y, window.innerHeight - 300)

  const teamRealms = realms.filter((r) => !r.isPersonal)

  return createPortal(
    <div className="fixed inset-0 z-[300]" onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menuRef}
        className="fixed min-w-[180px] py-1.5 rounded-xl bg-[#1a1a24]/95 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{ left: clampedX, top: clampedY }}
      >
        <MenuButton icon={<Pencil className="w-3.5 h-3.5" />} label="Edit" onClick={() => { onEdit(); onClose() }} />
        <MenuButton icon={<Users className="w-3.5 h-3.5" />} label="Share" onClick={() => { onShare(); onClose() }} />

        <div className="my-1 h-px bg-white/10" />

        {teamRealms.length > 0 && (
          <div className="group/realm relative">
            <div className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-default transition-colors">
              <Orbit className="w-3.5 h-3.5" />
              <span className="flex-1">Realms</span>
              <span className="text-[10px] text-slate-600">{'>'}</span>
            </div>
            <div
              ref={subRef}
              className="absolute left-full top-0 ml-1 min-w-[180px] py-1.5 rounded-xl bg-[#1a1a24]/95 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.5)] hidden group-hover/realm:block"
            >
              {teamRealms.map((realm) => {
                const isIn = projectRealmIds.includes(realm.id)
                return (
                  <button
                    key={realm.id}
                    onClick={() => onToggleRealm(realm.id)}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: realm.color.startsWith('#') ? realm.color : 'var(--primary)' }}
                    />
                    <span className="flex-1 text-left truncate">{realm.name}</span>
                    {isIn && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                  </button>
                )
              })}
              {teamRealms.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-slate-600">No team realms</div>
              )}
            </div>
          </div>
        )}

        <div className="my-1 h-px bg-white/10" />

        <MenuButton
          icon={<Trash2 className="w-3.5 h-3.5" />}
          label="Delete"
          variant="danger"
          onClick={() => { onDelete(); onClose() }}
        />
      </div>
    </div>,
    document.body
  )
}

function MenuButton({ icon, label, variant, onClick }: {
  icon: React.ReactNode
  label: string
  variant?: 'danger'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-xs transition-colors ${
        variant === 'danger'
          ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
          : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
