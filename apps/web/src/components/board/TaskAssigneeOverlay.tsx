'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X, Check, Mail, UserPlus } from 'lucide-react'
import {
  listTaskAssignees,
  assignTaskAction,
  unassignTaskAction,
} from '@/lib/actions/assignees'
import { getProjectMembers } from '@/lib/actions/members'
import { useBoardStore, useSelectedTaskId } from '@/lib/store/boardStore'
import { toast } from '@/components/ui/Toast'

// ─────────────────────────────────────────────────────────────────────────
// Aeon side quest — Trello-style task assignment.
//
// Listens globally for `m` while a card is selected and no input is focused.
// Opens a glassy member picker. Single-member boards see a graceful hint
// instead of an empty list. Multi-select toggle assigns/unassigns inline.
// ─────────────────────────────────────────────────────────────────────────

type Member = {
  userId: string
  role: string
  name: string | null
  email: string
  image: string | null
}

type Assignee = {
  userId: string
  name: string | null
  email: string
  image: string | null
}

interface Props {
  projectId: string
}

export function TaskAssigneeOverlay({ projectId }: Props) {
  const selectedTaskId = useSelectedTaskId()
  const tasks = useBoardStore((s) => s.tasks)
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const taskName = useMemo(() => {
    if (!selectedTaskId) return ''
    return tasks.find((t) => t.id === selectedTaskId)?.name ?? ''
  }, [tasks, selectedTaskId])

  // Hotkey: `m` opens the overlay when a task is selected and no input is focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (!selectedTaskId) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedTaskId, open])

  // Hydrate on open / when target task changes.
  useEffect(() => {
    if (!open || !selectedTaskId) return
    void (async () => {
      try {
        const [memberRows, assigneeRows] = await Promise.all([
          getProjectMembers(projectId),
          listTaskAssignees(projectId, selectedTaskId),
        ])
        setMembers(memberRows as Member[])
        setAssignees(assigneeRows)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load members', { force: true })
        setOpen(false)
      }
    })()
  }, [open, selectedTaskId, projectId])

  const assignedIds = useMemo(() => new Set(assignees.map((a) => a.userId)), [assignees])

  const filteredMembers = useMemo(() => {
    if (!query.trim()) return members
    const q = query.trim().toLowerCase()
    return members.filter(
      (m) => (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    )
  }, [members, query])

  const toggleMember = useCallback(async (member: Member) => {
    if (!selectedTaskId) return
    setBusyId(member.userId)
    try {
      if (assignedIds.has(member.userId)) {
        await unassignTaskAction(projectId, selectedTaskId, member.userId)
        setAssignees((prev) => prev.filter((a) => a.userId !== member.userId))
      } else {
        await assignTaskAction(projectId, selectedTaskId, member.userId)
        setAssignees((prev) => [
          ...prev,
          { userId: member.userId, name: member.name, email: member.email, image: member.image },
        ])
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Assignment failed', { force: true })
    } finally {
      setBusyId(null)
    }
  }, [assignedIds, projectId, selectedTaskId])

  if (!open || !selectedTaskId) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[250] flex items-center justify-center"
        onClick={() => setOpen(false)}
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
            <button onClick={() => setOpen(false)} className="p-1 rounded-md text-white/35 hover:text-white/85">
              <X className="w-3.5 h-3.5" />
            </button>
          </header>

          {members.length <= 1 ? (
            <SoloOwnerHint />
          ) : (
            <>
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

              <ul className="flex-1 overflow-y-auto py-1">
                {filteredMembers.length === 0 ? (
                  <li className="px-4 py-3 text-[12px] text-white/40">No members match &ldquo;{query}&rdquo;.</li>
                ) : (
                  filteredMembers.map((m) => {
                    const assigned = assignedIds.has(m.userId)
                    const isBusy = busyId === m.userId
                    return (
                      <li key={m.userId}>
                        <button
                          onClick={() => toggleMember(m)}
                          disabled={isBusy}
                          className={`group w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                            assigned ? 'bg-white/[0.03]' : 'hover:bg-white/[0.025]'
                          } disabled:opacity-50`}
                        >
                          <Avatar member={m} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] text-white/85 truncate">
                              {m.name ?? m.email.split('@')[0]}
                            </div>
                            <div className="text-[10.5px] text-white/40 truncate">{m.email}</div>
                          </div>
                          <span className={`text-[9px] uppercase tracking-[0.14em] mr-1 ${assigned ? 'text-emerald-300' : 'text-white/30'}`}>
                            {m.role}
                          </span>
                          <span
                            className={`shrink-0 w-5 h-5 rounded-md inline-flex items-center justify-center transition-colors ${
                              assigned
                                ? 'bg-emerald-500/20 border border-emerald-500/35 text-emerald-200'
                                : 'bg-white/[0.03] border border-white/[0.08] text-white/30 group-hover:text-white/60'
                            }`}
                          >
                            <Check className="w-3 h-3" style={{ opacity: assigned ? 1 : 0 }} />
                          </span>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>

              <footer className="px-4 py-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-white/40">
                <span>{assignees.length} assigned · {members.length} member{members.length === 1 ? '' : 's'}</span>
                <span>Press <kbd className="px-1 rounded bg-white/[0.05] border border-white/[0.08]">Esc</kbd> to close</span>
              </footer>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function Avatar({ member }: { member: { name: string | null; email: string; image: string | null } }) {
  if (member.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover border border-white/[0.08]" />
  }
  const seed = (member.name ?? member.email).trim()
  const initials = seed
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || seed[0]?.toUpperCase()
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <span
      className="w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center text-[10px] font-semibold text-white border border-white/[0.08]"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 55% 35%))`,
      }}
    >
      {initials}
    </span>
  )
}

function SoloOwnerHint() {
  return (
    <div className="px-6 py-8 flex flex-col items-center text-center gap-3">
      <div
        className="w-12 h-12 rounded-full inline-flex items-center justify-center"
        style={{
          background: 'color-mix(in oklab, var(--primary) 12%, transparent)',
          color: 'color-mix(in oklab, var(--primary) 35%, white)',
        }}
      >
        <UserPlus className="w-5 h-5" />
      </div>
      <div className="text-[13px] text-white/85 font-medium">You&apos;re the only member here</div>
      <div className="text-[11.5px] text-white/45 leading-relaxed max-w-xs">
        Card assignment activates once this board has more than one person. Invite a collaborator from the project sidebar to start assigning.
      </div>
      <div className="mt-1 inline-flex items-center gap-1.5 text-[10.5px] text-white/35">
        <Mail className="w-3 h-3" />
        Members → Invite (sidebar)
      </div>
    </div>
  )
}
