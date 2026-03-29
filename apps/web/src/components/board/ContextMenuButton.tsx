'use client'

import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { LucideIcon } from 'lucide-react'

interface ContextMenuButtonProps {
  icon: LucideIcon
  label: string
  hasSubmenu?: boolean
  isActive?: boolean
  onClick?: () => void
  glowColor?: string
}

export function ContextMenuButton({
  icon: Icon,
  label,
  hasSubmenu,
  isActive,
  onClick,
  glowColor,
}: ContextMenuButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-all duration-150',
        isActive ? 'text-white' : 'text-slate-300 hover:text-white'
      )}
      style={isActive && glowColor ? { background: glowColor.replace(/[\d.]+\)$/, '0.1)') } : {}}
    >
      <span className="flex items-center gap-2">
        <Icon
          className="w-4 h-4 transition-colors"
          style={isActive && glowColor ? { color: glowColor.replace(/[\d.]+\)$/, '0.8)') } : {}}
        />
        {label}
      </span>
      {hasSubmenu && (
        <ArrowRight
          className={cn('w-3 h-3 transition-transform duration-200', isActive ? 'rotate-90' : '')}
          style={isActive && glowColor ? { color: glowColor.replace(/[\d.]+\)$/, '0.7)') } : { color: 'rgb(100,116,139)' }}
        />
      )}
    </button>
  )
}
