'use client'

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, Pencil, Trash2 } from 'lucide-react'
import {
  createVirtualMemberAction,
  updateVirtualMemberAction,
  deleteVirtualMemberAction,
} from '@/lib/actions/virtual-members'
import { useBoardStore, type TaskAssigneePill, type VirtualMemberLite } from '@/lib/store/boardStore'
import { invalidateAssignablePeople } from '@/lib/store/membersCache'
import { colorConfig, ACCENT_COLORS } from '@/lib/utils/colors'
import { VirtualAvatar } from '@/components/ui/MemberAvatar'
import { getInitials } from '@/lib/utils/initials'
import { toast } from '@/components/ui/Toast'
import { AssignCheck } from './AssignCheck'

// ─── Virtual members — list + inline manage (create/rename/recolor/delete) ──

/**
 * Rewrites ONLY the pills belonging to one virtual member, against whatever
 * the store holds at call time. Never snapshot-and-restore the whole
 * assigneesByTask map: a write that fails seconds later would then erase every
 * assignment the user made in the meantime (the exact rule
 * lib/store/assigneeMutations.ts documents for the toggle path).
 */
function patchVirtualPills(memberId: string, patch: { name?: string; color?: string; initials?: string }): void {
  const { assigneesByTask, setAssigneesByTask } = useBoardStore.getState()
  const next = { ...assigneesByTask }
  let changed = false
  for (const [tid, list] of Object.entries(assigneesByTask)) {
    if (!list.some((p) => p.userId === memberId)) continue
    next[tid] = list.map((p) =>
      p.userId === memberId
        ? { ...p, name: patch.name ?? p.name, color: patch.color ?? p.color, initials: patch.initials ?? p.initials }
        : p,
    )
    changed = true
  }
  if (changed) setAssigneesByTask(next)
}

/**
 * Client-side mirror of `deriveInitials` in lib/data/virtual-members.ts, used
 * only to show what clearing the field will fall back to. The server stays
 * authoritative — it re-derives on its own when `initials` is absent.
 */
function deriveDisplayInitials(name: string): string {
  return getInitials(name, '?')
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

export function VirtualMemberSection({
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
  const update = useCallback((id: string, updates: { name?: string; color?: string; initials?: string }) => {
    const { virtualMembers, setVirtualMembers } = useBoardStore.getState()
    const before = virtualMembers.find((v) => v.id === id)
    setVirtualMembers(virtualMembers.map((v) => v.id === id ? { ...v, ...updates } : v))
    // Pills carry name/color/initials — keep them in sync.
    patchVirtualPills(id, updates)
    invalidateAssignablePeople(projectId)
    updateVirtualMemberAction(projectId, id, updates).catch((err) => {
      // Surgical revert: only this member's row and only this member's pills,
      // recomputed from current state so concurrent assignments survive.
      if (before) {
        const store = useBoardStore.getState()
        store.setVirtualMembers(
          store.virtualMembers.map((v) => v.id === id ? { ...v, name: before.name, color: before.color, initials: before.initials } : v),
        )
        patchVirtualPills(id, { name: before.name, color: before.color, initials: before.initials })
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
  onSave: (updates: { name?: string; color?: string; initials?: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(member.name)
  const [color, setColor] = useState(member.color)
  const [initials, setInitials] = useState(member.initials)

  const commit = () => {
    const trimmed = name.trim()
    if (!trimmed) return onCancel()
    // Empty initials means "back to derived" rather than a write the column
    // (NOT NULL, varchar(4)) would reject.
    const nextInitials = initials.trim().slice(0, 4) || deriveDisplayInitials(trimmed)
    const updates: { name?: string; color?: string; initials?: string } = {}
    if (trimmed !== member.name) updates.name = trimmed
    if (color !== member.color) updates.color = color
    if (nextInitials !== member.initials) updates.initials = nextInitials
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
        <VirtualAvatar
          name={name || member.name}
          initials={initials.trim().slice(0, 4) || deriveDisplayInitials(name.trim() || member.name)}
          color={color}
          size="sm"
        />
        <input
          type="text"
          value={initials}
          maxLength={4}
          onChange={(e) => setInitials(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
          }}
          placeholder="AR"
          aria-label="Initials"
          title="Initials shown on cards — up to 4 characters. Leave empty to derive from the name."
          className="w-14 px-2 py-1.5 text-[12px] text-center uppercase rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85"
        />
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

export function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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
