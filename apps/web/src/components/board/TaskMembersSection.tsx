'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useTaskAssignees, type TaskAssigneePill } from '@/lib/store/boardStore'
import { toggleAssigneeOptimistic } from '@/lib/store/assigneeMutations'
import { unassignTaskAction, unassignVirtualTaskAction } from '@/lib/actions/assignees'
import { MemberAvatar, VirtualAvatar } from '@/components/ui/MemberAvatar'
import { getInitials } from '@/lib/utils/initials'
import { TaskAssigneeOverlay } from './TaskAssigneeOverlay'
import { useAvatarPrefs } from './sizing'

/**
 * The card-edit view's "Members" row. Shows who is on the card and opens the
 * SAME assignee picker the board's `M` shortcut uses — real members, virtual
 * members, the pencil editor — rather than a second, forked list. Removing a
 * pill here rides the same optimistic toggle + action as the card face.
 */
export function TaskMembersSection({ taskId, projectId }: { taskId: string; projectId: string }) {
  const assignees = useTaskAssignees(taskId) ?? []
  const avatarPrefs = useAvatarPrefs()
  const [pickerOpen, setPickerOpen] = useState(false)

  // The modal shell and the picker both close on Escape from a window
  // listener. Catch it first in the capture phase while the picker is open so
  // one Escape closes only the picker, not the whole card.
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setPickerOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [pickerOpen])

  const remove = (pill: TaskAssigneePill) => {
    void toggleAssigneeOptimistic({
      taskId,
      pill,
      assign: false,
      run: () => pill.kind === 'virtual'
        ? unassignVirtualTaskAction(projectId, taskId, pill.userId)
        : unassignTaskAction(projectId, taskId, pill.userId),
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm text-slate-400">Members</label>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors"
        >
          <UserPlus className="w-3 h-3" />
          Add member
        </button>
      </div>
      {assignees.length === 0 ? (
        <p className="text-xs text-slate-500">Nobody yet — add a member to put this card on their plate.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {assignees.map((a) => {
            const label = a.name ?? a.email ?? 'Member'
            return (
              <li
                key={a.userId}
                className={cn(
                  'group flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-lg',
                  'bg-white/5 border border-white/10 text-xs text-slate-200',
                )}
              >
                {a.kind === 'virtual' ? (
                  <VirtualAvatar
                    name={a.name ?? 'Virtual member'}
                    initials={(a.initials ?? '').trim() || getInitials(a.name, '?')}
                    color={a.color ?? 'purple'}
                    size="sm"
                  />
                ) : (
                  <MemberAvatar
                    member={{ name: a.name, email: a.email ?? '', image: a.image, initials: a.initials, color: a.color }}
                    preferInitials={avatarPrefs.preferInitials}
                  />
                )}
                <span className="max-w-[9rem] truncate">{label}</span>
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={`Remove ${label}`}
                  title="Remove from card"
                  className="p-0.5 rounded text-slate-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {pickerOpen && typeof document !== 'undefined' && createPortal(
        <TaskAssigneeOverlay projectId={projectId} taskId={taskId} onClose={() => setPickerOpen(false)} />,
        document.body,
      )}
    </div>
  )
}
