'use client'

import { useState, useCallback, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils/cn'
import { colorConfig, resolveColor, AccentColor } from '@/lib/utils/colors'

interface RowContainerProps {
  row: {
    id: string
    name: string
    color: string
  }
  height: number
  isEven: boolean
  children?: React.ReactNode
  onRename?: (rowId: string, name: string) => void
}

export function RowContainer({ row, height, isEven, children, onRename }: RowContainerProps) {
  const preset = colorConfig[row.color as AccentColor]
  const resolved = resolveColor(row.color)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: row.id,
    data: { type: 'row', row },
  })

  const handleDoubleClick = useCallback(() => {
    setEditName(row.name)
    setIsEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [row.name])

  const commitRename = useCallback(() => {
    const trimmed = editName.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== row.name && onRename) {
      onRename(row.id, trimmed)
    }
  }, [editName, row.id, row.name, onRename])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setIsEditing(false)
  }, [commitRename])

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex border-b border-white/5 transition-colors duration-200',
        isEven && 'bg-white/[0.02]',
        isOver && 'bg-white/[0.05]'
      )}
      style={{ height }}
    >
      <div className="w-48 flex-shrink-0 px-4 py-2 border-r border-white/10 flex items-center gap-2">
        <div
          className={cn('w-2 h-2 rounded-full flex-shrink-0', preset?.bgSolid)}
          style={{
            backgroundColor: !preset ? resolved.hex : undefined,
            boxShadow: `0 0 8px ${resolved.glow}`,
          }}
        />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className={cn(
              'text-sm font-medium bg-transparent outline-none w-full',
              preset?.text
            )}
            style={!preset ? { color: resolved.hex } : undefined}
            autoFocus
          />
        ) : (
          <span
            className={cn('text-sm font-medium truncate cursor-text', preset?.text)}
            style={!preset ? { color: resolved.hex } : undefined}
            onDoubleClick={handleDoubleClick}
          >
            {row.name}
          </span>
        )}
      </div>
      <div className="flex-1 relative">
        {children}
      </div>
    </div>
  )
}
