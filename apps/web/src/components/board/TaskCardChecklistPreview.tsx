'use client'

import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { ChecklistPreviewItem } from '@/lib/store/boardStore'

function ChecklistPreviewRow({ item }: { item: ChecklistPreviewItem }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        'w-2.5 h-2.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
        item.state === 'checked' && 'bg-emerald-500/30 border-emerald-500/50',
        item.state === 'crossed' && 'bg-red-500/30 border-red-500/50',
        item.state === 'unchecked' && 'border-white/20',
      )}>
        {item.state === 'checked' && <Check className="w-1.5 h-1.5 text-emerald-400" />}
        {item.state === 'crossed' && <X className="w-1.5 h-1.5 text-red-400" />}
      </div>
      <span className={cn(
        'text-[10px] truncate leading-tight',
        item.state === 'checked' && 'text-slate-600 line-through',
        item.state === 'crossed' && 'text-red-400/40 line-through',
        item.state === 'unchecked' && 'text-slate-400',
      )}>
        {item.title}
      </span>
    </div>
  )
}

// 'preview' shows the first five items flat; 'full' shows every item grouped.
export function TaskCardChecklistPreview({ items, mode }: { items: ChecklistPreviewItem[]; mode: 'preview' | 'full' }) {
  if (mode === 'preview') {
    return (
      <div className="space-y-0.5 mb-1.5">
        {items.slice(0, 5).map((item, i) => (
          <ChecklistPreviewRow key={i} item={item} />
        ))}
        {items.length > 5 && (
          <span className="text-[9px] text-slate-600 pl-4">+{items.length - 5} more</span>
        )}
      </div>
    )
  }
  const groups = new Map<string, ChecklistPreviewItem[]>()
  for (const item of items) {
    const g = item.groupName || 'Checklist'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }
  return (
    <div className="space-y-1.5 mb-1.5">
      {[...groups.entries()].map(([groupName, groupItems]) => (
        <div key={groupName}>
          <span className="text-[9px] uppercase tracking-wider text-slate-600 font-medium">{groupName}</span>
          <div className="space-y-0.5 mt-0.5">
            {groupItems.map((item, i) => (
              <ChecklistPreviewRow key={i} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
