'use client'

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
}

export function RowContainer({ row, height, isEven, children }: RowContainerProps) {
  const preset = colorConfig[row.color as AccentColor]
  const resolved = resolveColor(row.color)

  const { setNodeRef, isOver } = useDroppable({
    id: row.id,
    data: { type: 'row', row },
  })

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
          className={cn('w-2 h-2 rounded-full', preset?.bgSolid)}
          style={{
            backgroundColor: !preset ? resolved.hex : undefined,
            boxShadow: `0 0 8px ${resolved.glow}`,
          }}
        />
        <span
          className={cn('text-sm font-medium truncate', preset?.text)}
          style={!preset ? { color: resolved.hex } : undefined}
        >
          {row.name}
        </span>
      </div>
      <div className="flex-1 relative">
        {children}
      </div>
    </div>
  )
}
