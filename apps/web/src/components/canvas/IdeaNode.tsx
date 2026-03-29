import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Pencil, Trash2, GripVertical } from 'lucide-react'
import { colorConfig, type AccentColor } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'

export interface IdeaNodeData {
  name: string
  description?: string
  color: string
  onUpdate?: (id: string, updates: { name?: string; description?: string; color?: string }) => void
  onDelete?: (id: string) => void
}

const COLORS: AccentColor[] = ['purple', 'blue', 'cyan', 'green', 'pink', 'orange', 'red']

function IdeaNodeComponent({ id, data, selected }: NodeProps & { data: IdeaNodeData }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(data.name)
  const [editDesc, setEditDesc] = useState(data.description || '')
  const nameRef = useRef<HTMLInputElement>(null)
  const cfg = colorConfig[data.color as AccentColor] || colorConfig.purple

  useEffect(() => {
    if (editing && nameRef.current) nameRef.current.focus()
  }, [editing])

  const commitEdit = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && data.onUpdate) {
      data.onUpdate(id, {
        name: trimmed,
        description: editDesc.trim() || undefined,
      })
    }
    setEditing(false)
  }, [id, editName, editDesc, data])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEdit()
    }
    if (e.key === 'Escape') {
      setEditName(data.name)
      setEditDesc(data.description || '')
      setEditing(false)
    }
  }, [commitEdit, data.name, data.description])

  return (
    <div
      className={cn(
        'group relative min-w-[200px] max-w-[280px] rounded-xl border backdrop-blur-xl transition-all duration-200',
        selected
          ? 'ring-2 shadow-lg scale-[1.02]'
          : 'hover:shadow-md hover:scale-[1.01]'
      )}
      style={{
        background: `linear-gradient(to bottom, ${cfg.hex}12, rgba(0,0,0,0.3))`,
        borderColor: selected ? cfg.hex : `${cfg.hex}35`,
        boxShadow: [
          selected ? `0 0 24px ${cfg.hex}30` : `0 0 12px ${cfg.hex}10`,
          'inset 0 1px 0 0 rgba(255,255,255,0.08)',
          '0 8px 32px rgba(0,0,0,0.3)',
        ].join(', '),
        ...(selected ? { ringColor: cfg.hex } : {}),
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !border-2 !rounded-full !-left-1.5"
        style={{ backgroundColor: cfg.hex, borderColor: 'rgba(0,0,0,0.3)', boxShadow: `0 0 6px ${cfg.hex}50` }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !rounded-full !-right-1.5"
        style={{ backgroundColor: cfg.hex, borderColor: 'rgba(0,0,0,0.3)', boxShadow: `0 0 6px ${cfg.hex}50` }}
      />

      <div
        className="h-[2px] rounded-t-xl"
        style={{ backgroundColor: cfg.hex, boxShadow: `0 0 8px ${cfg.hex}60` }}
      />

      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
            <GripVertical className="w-3.5 h-3.5 text-slate-500" />
          </div>

          {editing ? (
            <input
              ref={nameRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              className="flex-1 bg-transparent text-sm font-semibold text-white outline-none border-b border-white/20 pb-0.5"
            />
          ) : (
            <span className="flex-1 text-sm font-semibold text-white leading-snug">
              {data.name}
            </span>
          )}

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelete?.(id) }}
              className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {editing ? (
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Description..."
            rows={2}
            className="w-full bg-transparent text-xs text-slate-300 outline-none border border-white/10 rounded-md p-1.5 resize-none"
          />
        ) : data.description ? (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
            {data.description}
          </p>
        ) : null}

        <div className="flex gap-1 pt-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={(e) => { e.stopPropagation(); data.onUpdate?.(id, { color: c }) }}
              className={cn(
                'w-3.5 h-3.5 rounded-full transition-all opacity-0 group-hover:opacity-100',
                data.color === c ? 'ring-1 ring-white/50 scale-125 !opacity-100' : 'hover:scale-110'
              )}
              style={{ backgroundColor: colorConfig[c].hex }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export const IdeaNode = memo(IdeaNodeComponent)
