'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X, Check, Mail, UserPlus, Pencil, Trash2 } from 'lucide-react'
import {
  assignTaskAction,
  unassignTaskAction,
  assignVirtualTaskAction,
  unassignVirtualTaskAction,
} from '@/lib/actions/assignees'
import {
  createVirtualMemberAction,
  updateVirtualMemberAction,
  deleteVirtualMemberAction,
} from '@/lib/actions/virtual-members'
import {
  useBoardStore,
  useTaskAssignees,
  useVirtualMembers,
  type TaskAssigneePill,
  type VirtualMemberLite,
} from '@/lib/store/boardStore'
import { currentAssignees, toggleAssigneeOptimistic } from '@/lib/store/assigneeMutations'
import { getAssignablePeopleCached, peekAssignablePeople, invalidateAssignablePeople } from '@/lib/store/membersCache'
import { colorConfig, resolveAccentHex, ACCENT_COLORS } from '@/lib/utils/colors'
import { getInitials } from '@/lib/utils/initials'
import { toast } from '@/components/ui/Toast'

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

function AssignCheck({ assigned }: { assigned: boolean }) {
  return (
    <span
      className={`shrink-0 w-5 h-5 rounded-md inline-flex items-center justify-center transition-colors ${
        assigned
          ? 'bg-emerald-500/20 border border-emerald-500/35 text-emerald-200'
          : 'bg-white/[0.03] border border-white/[0.08] text-white/30 group-hover:text-white/60'
      }`}
    >
      <Check className="w-3 h-3" style={{ opacity: assigned ? 1 : 0 }} />
    </span>
  )
}

// ─── Virtual members — list + inline manage (create/rename/recolor/delete) ──

/**
 * Rewrites ONLY the pills belonging to one virtual member, against whatever
 * the store holds at call time. Never snapshot-and-restore the whole
 * assigneesByTask map: a write that fails seconds later would then erase every
 * assignment the user made in the meantime (the exact rule
 * lib/store/assigneeMutations.ts documents for the toggle path).
 */
function patchVirtualPills(memberId: string, patch: { name?: string; color?: string }): void {
  const { assigneesByTask, setAssigneesByTask } = useBoardStore.getState()
  const next = { ...assigneesByTask }
  let changed = false
  for (const [tid, list] of Object.entries(assigneesByTask)) {
    if (!list.some((p) => p.userId === memberId)) continue
    next[tid] = list.map((p) =>
      p.userId === memberId ? { ...p, name: patch.name ?? p.name, color: patch.color ?? p.color } : p,
    )
    changed = true
  }
  if (changed) setAssigneesByTask(next)
}

/** Drops one virtual member's pills everywhere, returning what was removed. */
function removeVirtualPills(memberId: string): Array<{ taskId: string; pill: TaskAssigneePill }> {
  const { assigneesByTask, setAssigneesByTask } = useBoardStore.getState()
  const removed: Array<{ taskId: string; pill: TaskAssigneePill }> = []
  const next = { ...assigneesByTask }
  for (const [tid, list] of Object.entries(assigneesByTask)) {
    const pill = list.find((p) => p.userId === memberId)
    if (!pill) continue
    removed.push({ taskId: tid, pill })
    next[tid] = list.filter((p) => p.userId !== memberId)
  }
  if (removed.length > 0) setAssigneesByTask(next)
  return removed
}

/** Puts those pills back, merging into the CURRENT lists rather than replacing them. */
function restoreVirtualPills(memberId: string, removed: Array<{ taskId: string; pill: TaskAssigneePill }>): void {
  if (removed.length === 0) return
  const { assigneesByTask, setAssigneesByTask } = useBoardStore.getState()
  const next = { ...assigneesByTask }
  for (const { taskId, pill } of removed) {
    const list = next[taskId] ?? []
    if (list.some((p) => p.userId === memberId)) continue
    next[taskId] = [...list, pill]
  }
  setAssigneesByTask(next)
}

// A stale two-click delete arm is dangerous: deleting a virtual member strips
// that person's assignments across every project in the realm. Disarm fast.
const DELETE_ARM_TTL_MS = 3000

function VirtualMemberSection({
  projectId,
  members,
  assignedIds,
  onToggle,
  query,
}: {
  projectId: string
  members: VirtualMemberLite[]
  assignedIds: Set<string>
  onToggle: (m: VirtualMemberLite) => void
  query: string
}) {
  const hasQuery = !!query.trim()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>('purple')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)

  // An arm expires on its own, and never survives a change to what the list is
  // showing — otherwise one stray click on a later visit deletes a person.
  useEffect(() => {
    if (!armedDeleteId) return
    const t = setTimeout(() => setArmedDeleteId(null), DELETE_ARM_TTL_MS)
    return () => clearTimeout(t)
  }, [armedDeleteId])

  useEffect(() => { setArmedDeleteId(null) }, [query])

  const create = useCallback(async () => {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      const created = await createVirtualMemberAction(projectId, { name, color: newColor })
      const { virtualMembers, setVirtualMembers } = useBoardStore.getState()
      setVirtualMembers([...virtualMembers, { id: created.id, name: created.name, initials: created.initials, color: created.color }])
      invalidateAssignablePeople(projectId)
      setNewName('')
      setCreating(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create virtual member', { force: true })
    } finally {
      setSaving(false)
    }
  }, [newName, newColor, projectId, saving])

  // Rename/recolor is optimistic: the store updates instantly, the server
  // write happens in the background and reverts on hard failure.
  const update = useCallback((id: string, updates: { name?: string; color?: string }) => {
    const { virtualMembers, setVirtualMembers } = useBoardStore.getState()
    const before = virtualMembers.find((v) => v.id === id)
    setVirtualMembers(virtualMembers.map((v) => v.id === id ? { ...v, ...updates } : v))
    // Pills carry name/color — keep them in sync.
    patchVirtualPills(id, updates)
    invalidateAssignablePeople(projectId)
    updateVirtualMemberAction(projectId, id, updates).catch((err) => {
      // Surgical revert: only this member's row and only this member's pills,
      // recomputed from current state so concurrent assignments survive.
      if (before) {
        const store = useBoardStore.getState()
        store.setVirtualMembers(
          store.virtualMembers.map((v) => v.id === id ? { ...v, name: before.name, color: before.color } : v),
        )
        patchVirtualPills(id, { name: before.name, color: before.color })
      }
      toast(err instanceof Error ? err.message : 'Could not update virtual member — reverted', { force: true })
    })
  }, [projectId])

  // Delete is optimistic too: member + its pills vanish immediately; the
  // server cleans assignments in a transaction and reverts on failure.
  const remove = useCallback((id: string) => {
    const { virtualMembers, setVirtualMembers } = useBoardStore.getState()
    const removedMember = virtualMembers.find((v) => v.id === id)
    const removedIndex = virtualMembers.findIndex((v) => v.id === id)
    setVirtualMembers(virtualMembers.filter((v) => v.id !== id))
    const removedPills = removeVirtualPills(id)
    invalidateAssignablePeople(projectId)
    setArmedDeleteId(null)
    deleteVirtualMemberAction(projectId, id).catch((err) => {
      // Surgical revert: re-insert this member and its own pills into the
      // CURRENT lists — a whole-map restore would wipe out anything the user
      // assigned elsewhere while the delete was in flight.
      if (removedMember) {
        const store = useBoardStore.getState()
        if (!store.virtualMembers.some((v) => v.id === id)) {
          const next = [...store.virtualMembers]
          next.splice(Math.min(Math.max(removedIndex, 0), next.length), 0, removedMember)
          store.setVirtualMembers(next)
        }
      }
      restoreVirtualPills(id, removedPills)
      toast(err instanceof Error ? err.message : 'Could not delete virtual member — reverted', { force: true })
    })
  }, [projectId])

  return (
    <div className="border-t border-white/[0.04] mt-1 pt-1">
      <div className="px-4 py-1.5 flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.2em] text-white/35">Virtual members</span>
        <button
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1 text-[10px] text-white/45 hover:text-white/85 transition-colors"
        >
          <UserPlus className="w-3 h-3" />
          New
        </button>
      </div>

      {creating && (
        <div className="px-4 py-2 space-y-2">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create() }}
            placeholder="Name (no account needed)"
            className="w-full px-3 py-1.5 text-[12px] rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85 placeholder:text-white/30"
          />
          <div className="flex items-center gap-2">
            <ColorDots value={newColor} onChange={setNewColor} />
            <div className="flex-1" />
            <button
              onClick={() => void create()}
              disabled={!newName.trim() || saving}
              className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.06] border border-white/[0.1] text-white/80 hover:bg-white/[0.1] disabled:opacity-40 transition-colors"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {members.length === 0 && !creating && !hasQuery && (
        <div className="px-4 pb-2 text-[10.5px] text-white/30">
          Track people who don&apos;t use Aeon — assignable like real members.
        </div>
      )}

      <ul>
        {members.map((v) => {
          const assigned = assignedIds.has(v.id)
          const isEditing = editingId === v.id
          return (
            <li key={v.id}>
              {isEditing ? (
                <VirtualEditRow
                  member={v}
                  onSave={(updates) => { update(v.id, updates); setEditingId(null) }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div
                  className={`group w-full flex items-center gap-3 px-4 py-2 transition-colors ${
                    assigned ? 'bg-white/[0.03]' : 'hover:bg-white/[0.025]'
                  }`}
                >
                  <button onClick={() => onToggle(v)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <VirtualAvatar name={v.name} initials={v.initials} color={v.color} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-white/85 truncate">{v.name}</div>
                      <div className="text-[10px] text-white/35">virtual</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setEditingId(v.id); setArmedDeleteId(null) }}
                    className="p-1 rounded text-white/25 opacity-0 group-hover:opacity-100 hover:text-white/75 transition-all"
                    title="Rename / recolor"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => armedDeleteId === v.id ? remove(v.id) : setArmedDeleteId(v.id)}
                    className={`p-1 rounded transition-all ${
                      armedDeleteId === v.id
                        ? 'text-red-300 bg-red-500/15'
                        : 'text-white/25 opacity-0 group-hover:opacity-100 hover:text-red-300'
                    }`}
                    title={armedDeleteId === v.id ? 'Click again to delete' : 'Delete virtual member'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => onToggle(v)} className="group inline-flex">
                    <AssignCheck assigned={assigned} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function VirtualEditRow({
  member,
  onSave,
  onCancel,
}: {
  member: VirtualMemberLite
  onSave: (updates: { name?: string; color?: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(member.name)
  const [color, setColor] = useState(member.color)

  const commit = () => {
    const trimmed = name.trim()
    if (!trimmed) return onCancel()
    const updates: { name?: string; color?: string } = {}
    if (trimmed !== member.name) updates.name = trimmed
    if (color !== member.color) updates.color = color
    if (Object.keys(updates).length === 0) return onCancel()
    onSave(updates)
  }

  return (
    <div className="px-4 py-2 space-y-2 bg-white/[0.02]">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
        }}
        className="w-full px-3 py-1.5 text-[12px] rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85"
      />
      <div className="flex items-center gap-2">
        <ColorDots value={color} onChange={setColor} />
        <div className="flex-1" />
        <button onClick={onCancel} className="px-2 py-1 rounded-md text-[11px] text-white/45 hover:text-white/80 transition-colors">Cancel</button>
        <button
          onClick={commit}
          className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.06] border border-white/[0.1] text-white/80 hover:bg-white/[0.1] transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {ACCENT_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-4 h-4 rounded-full border transition-transform ${value === c ? 'scale-110 border-white/80' : 'border-white/15 hover:scale-105'}`}
          style={{ background: colorConfig[c].hex }}
          title={c}
        />
      ))}
    </div>
  )
}

export function VirtualAvatar({ name, initials, color, size = 'md' }: { name: string; initials: string; color: string; size?: 'sm' | 'md' }) {
  const hex = resolveAccentHex(color)
  const cls = size === 'md' ? 'w-7 h-7 text-[10px]' : 'w-5 h-5 text-[8px]'
  return (
    <span
      className={`${cls} rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-white border border-dashed border-white/45`}
      style={{ background: `linear-gradient(135deg, ${hex}cc, ${hex}66)` }}
      title={`${name} (virtual)`}
    >
      {initials}
    </span>
  )
}

function Avatar({ member }: { member: { name: string | null; email: string; image: string | null } }) {
  if (member.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover border border-white/[0.08]" />
  }
  const seed = (member.name ?? member.email).trim()
  const initials = getInitials(seed)
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
