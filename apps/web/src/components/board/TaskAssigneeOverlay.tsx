'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X, Mail, UserPlus } from 'lucide-react'
import {
  assignTaskAction,
  unassignTaskAction,
  assignVirtualTaskAction,
  unassignVirtualTaskAction,
} from '@/lib/actions/assignees'
import {
  useBoardStore,
  useTaskAssignees,
  useVirtualMembers,
  type VirtualMemberLite,
} from '@/lib/store/boardStore'
import { currentAssignees, toggleAssigneeOptimistic } from '@/lib/store/assigneeMutations'
import { getAssignablePeopleCached, peekAssignablePeople } from '@/lib/store/membersCache'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { toast } from '@/components/ui/Toast'
import { AssignCheck } from './AssignCheck'
import { VirtualMemberSection } from './TaskAssigneeVirtualSection'

// ─────────────────────────────────────────────────────────────────────────
// Aeon side quest — Trello-style task assignment.
//
// Listens globally for `m` while a card is selected and no input is focused.
// Opens instantly: assigned state comes from the board store (hydrated with
// the board payload) and the member list from the per-project cache the board
// prefetches on mount — no server round trip on open. Toggling is optimistic:
// the pill lands immediately, the write persists in the background through
// the durable retry pipeline, and only a terminal failure reverts it.
//
// Below the real members: virtual team members — realm-scoped people without
// an Aeon account (dashed avatar ring), creatable/renamable/recolorable/
// deletable inline and assignable exactly like real members.
// ─────────────────────────────────────────────────────────────────────────

type Member = {
  userId: string
  role: string
  name: string | null
  email: string
  image: string | null
}

interface Props {
  projectId: string
  taskId: string | null
  onClose: () => void
}

export function TaskAssigneeOverlay({ projectId, taskId, onClose }: Props) {
  const tasks = useBoardStore((s) => s.tasks)
  const virtualMembers = useVirtualMembers()
  const storeAssignees = useTaskAssignees(taskId ?? '')
  const [members, setMembers] = useState<Member[]>(() => peekAssignablePeople(projectId)?.members as Member[] ?? [])
  const [query, setQuery] = useState('')

  const taskName = useMemo(() => {
    if (!taskId) return ''
    return tasks.find((t) => t.id === taskId)?.name ?? ''
  }, [tasks, taskId])

  // Opening is controlled by the parent (the board `M` shortcut, hover-aware).
  // Close on Escape.
  useEffect(() => {
    if (!taskId) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [taskId, onClose])

  // Refresh the member list from cache (instant when prefetched; a stale
  // entry still renders immediately while revalidating in the background).
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    getAssignablePeopleCached(projectId)
      .then((people) => {
        if (!cancelled) setMembers(people.members as Member[])
      })
      .catch((err) => {
        toast(err instanceof Error ? err.message : 'Failed to load members', { force: true })
      })
    return () => { cancelled = true }
  }, [taskId, projectId])

  const assignedIds = useMemo(() => new Set((storeAssignees ?? []).map((a) => a.userId)), [storeAssignees])

  const filteredMembers = useMemo(() => {
    if (!query.trim()) return members
    const q = query.trim().toLowerCase()
    return members.filter(
      (m) => (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    )
  }, [members, query])

  const filteredVirtual = useMemo(() => {
    if (!query.trim()) return virtualMembers
    const q = query.trim().toLowerCase()
    return virtualMembers.filter((v) => v.name.toLowerCase().includes(q))
  }, [virtualMembers, query])

  // Optimistic: pill updates instantly, server write rides the retry pipeline.
  // Intent is read from the STORE, not from the rendered `assignedIds` — two
  // clicks inside one React commit would otherwise both see the pre-click
  // state and send the same verb twice.
  const toggleMember = useCallback((member: Member) => {
    if (!taskId) return
    const isAssigned = currentAssignees(taskId).some((a) => a.userId === member.userId)
    void toggleAssigneeOptimistic({
      taskId,
      pill: { userId: member.userId, name: member.name, image: member.image },
      assign: !isAssigned,
      run: () => isAssigned
        ? unassignTaskAction(projectId, taskId, member.userId)
        : assignTaskAction(projectId, taskId, member.userId),
    })
  }, [projectId, taskId])

  const toggleVirtual = useCallback((member: VirtualMemberLite) => {
    if (!taskId) return
    const isAssigned = currentAssignees(taskId).some((a) => a.userId === member.id)
    void toggleAssigneeOptimistic({
      taskId,
      pill: { userId: member.id, name: member.name, image: null, kind: 'virtual', color: member.color },
      assign: !isAssigned,
      run: () => isAssigned
        ? unassignVirtualTaskAction(projectId, taskId, member.id)
        : assignVirtualTaskAction(projectId, taskId, member.id),
    })
  }, [projectId, taskId])

  if (!taskId) return null

  const soloAndEmpty = members.length <= 1 && virtualMembers.length === 0

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[250] flex items-center justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-[460px] max-w-[92vw] max-h-[78vh] rounded-2xl bg-[rgba(8,6,18,0.97)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Users className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">Assign</div>
              <div className="text-[13px] text-white/85 truncate">{taskName || 'Task'}</div>
            </div>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/45 border border-white/[0.08]">M</kbd>
            <button onClick={onClose} className="p-1 rounded-md text-white/35 hover:text-white/85">
              <X className="w-3.5 h-3.5" />
            </button>
          </header>

          <div className="px-3 py-2 border-b border-white/[0.04]">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="w-full px-3 py-2 text-[12px] rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85 placeholder:text-white/30"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {soloAndEmpty && <SoloOwnerHint />}

            {(members.length > 1 || virtualMembers.length > 0) && (
              <ul>
                {filteredMembers.length === 0 && filteredVirtual.length === 0 ? (
                  <li className="px-4 py-3 text-[12px] text-white/40">No members match &ldquo;{query}&rdquo;.</li>
                ) : (
                  filteredMembers.map((m) => {
                    const assigned = assignedIds.has(m.userId)
                    return (
                      <li key={m.userId}>
                        <button
                          onClick={() => toggleMember(m)}
                          className={`group w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                            assigned ? 'bg-white/[0.03]' : 'hover:bg-white/[0.025]'
                          }`}
                        >
                          <MemberAvatar member={m} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] text-white/85 truncate">
                              {m.name ?? m.email.split('@')[0]}
                            </div>
                            <div className="text-[10.5px] text-white/40 truncate">{m.email}</div>
                          </div>
                          <span className={`text-[9px] uppercase tracking-[0.14em] mr-1 ${assigned ? 'text-emerald-300' : 'text-white/30'}`}>
                            {m.role}
                          </span>
                          <AssignCheck assigned={assigned} />
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            )}

            {/* Keyed by task: switching cards without closing the overlay
                remounts the section, so no delete arm or half-typed rename
                leaks from the previous card. */}
            <VirtualMemberSection
              key={taskId}
              projectId={projectId}
              members={filteredVirtual}
              assignedIds={assignedIds}
              onToggle={toggleVirtual}
              query={query}
            />
          </div>

          <footer className="px-4 py-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-white/40">
            <span>{(storeAssignees ?? []).length} assigned · {members.length + virtualMembers.length} member{members.length + virtualMembers.length === 1 ? '' : 's'}</span>
            <span>Press <kbd className="px-1 rounded bg-white/[0.05] border border-white/[0.08]">Esc</kbd> to close</span>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function SoloOwnerHint() {
  return (
    <div className="px-6 py-5 flex flex-col items-center text-center gap-2.5">
      <div
        className="w-10 h-10 rounded-full inline-flex items-center justify-center"
        style={{
          background: 'color-mix(in oklab, var(--primary) 12%, transparent)',
          color: 'color-mix(in oklab, var(--primary) 35%, white)',
        }}
      >
        <UserPlus className="w-4 h-4" />
      </div>
      <div className="text-[13px] text-white/85 font-medium">You&apos;re the only member here</div>
      <div className="text-[11.5px] text-white/45 leading-relaxed max-w-xs">
        Invite a collaborator from the project sidebar — or add a <span className="text-white/70">virtual member</span> below to track someone who doesn&apos;t use Aeon.
      </div>
      <div className="inline-flex items-center gap-1.5 text-[10.5px] text-white/35">
        <Mail className="w-3 h-3" />
        Members → Invite (sidebar)
      </div>
    </div>
  )
}
