'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X, Mail, UserPlus, Pencil } from 'lucide-react'
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
import { getAssignablePeopleCached, peekAssignablePeople, invalidateAssignablePeople } from '@/lib/store/membersCache'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { toast } from '@/components/ui/Toast'
import { AssignCheck } from './AssignCheck'
import { VirtualMemberSection, ColorDots } from './TaskAssigneeVirtualSection'
import { setMemberProfileAction } from '@/lib/actions/member-profiles'
import { getInitials, getInitialsFromEmail } from '@/lib/utils/initials'
import { hasAvatarOverride } from '@/lib/utils/avatarStyle'
import { resolveAccentHex } from '@/lib/utils/colors'
import { useAvatarPrefs } from './sizing'

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
  /** The realm's display name when one is set, else the account's own. */
  name: string | null
  /** The account's own name, so the editor can show what an override replaces. */
  accountName?: string | null
  email: string
  image: string | null
  /** Realm overrides — null means "derive", exactly as before this existed. */
  initials?: string | null
  color?: string | null
  textColor?: string | null
  shape?: string | null
}

/** Tri-state patch: absent = leave alone, null = clear, value = set. */
type ProfilePatch = {
  initials?: string | null
  color?: string | null
  displayName?: string | null
  textColor?: string | null
  shape?: string | null
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
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const avatarPrefs = useAvatarPrefs()

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
      pill: { userId: member.userId, name: member.name, email: member.email, initials: member.initials, color: member.color, textColor: member.textColor, shape: member.shape, image: member.image },
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
      pill: { userId: member.id, name: member.name, initials: member.initials, image: null, kind: 'virtual', color: member.color },
      assign: !isAssigned,
      run: () => isAssigned
        ? unassignVirtualTaskAction(projectId, taskId, member.id)
        : assignVirtualTaskAction(projectId, taskId, member.id),
    })
  }, [projectId, taskId])

  // Restyling is optimistic like every other write here: the row and every
  // pill for that person update instantly, and a failed write puts back exactly
  // what was there rather than a reload's worth of unrelated state.
  const saveProfile = useCallback((userId: string, updates: ProfilePatch) => {
    const before = members.find((m) => m.userId === userId)
    if (!before) return

    const applyLocal = (patch: { name?: string | null; initials?: string | null; color?: string | null; textColor?: string | null; shape?: string | null }) => {
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, ...patch } : m))
      const { assigneesByTask, setAssigneesByTask } = useBoardStore.getState()
      const next = { ...assigneesByTask }
      let changed = false
      for (const [tid, list] of Object.entries(assigneesByTask)) {
        if (!list.some((pl) => pl.userId === userId && pl.kind !== 'virtual')) continue
        next[tid] = list.map((pl) =>
          pl.userId === userId && pl.kind !== 'virtual' ? { ...pl, ...patch } : pl,
        )
        changed = true
      }
      if (changed) setAssigneesByTask(next)
    }

    applyLocal({
      name: updates.displayName === undefined
        ? before.name
        : (updates.displayName ?? before.accountName ?? null),
      initials: updates.initials === undefined ? before.initials : updates.initials,
      color: updates.color === undefined ? before.color : updates.color,
      textColor: updates.textColor === undefined ? before.textColor : updates.textColor,
      shape: updates.shape === undefined ? before.shape : updates.shape,
    })
    invalidateAssignablePeople(projectId)

    setMemberProfileAction(projectId, userId, updates).catch((err) => {
      applyLocal({
        name: before.name,
        initials: before.initials ?? null,
        color: before.color ?? null,
        textColor: before.textColor ?? null,
        shape: before.shape ?? null,
      })
      toast(err instanceof Error ? err.message : 'Could not save — reverted', { force: true })
    })
  }, [members, projectId])

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
                    if (editingMemberId === m.userId) {
                      return (
                        <li key={m.userId}>
                          <MemberEditRow
                            member={m}
                            preferInitials={avatarPrefs.preferInitials}
                            onSave={(updates) => { setEditingMemberId(null); saveProfile(m.userId, updates) }}
                            onCancel={() => setEditingMemberId(null)}
                          />
                        </li>
                      )
                    }
                    return (
                      <li key={m.userId}>
                        {/* Two buttons, not one with a nested button: assigning and
                            restyling are different actions and nesting is invalid. */}
                        <div className={`group flex items-center transition-colors ${
                          assigned ? 'bg-white/[0.03]' : 'hover:bg-white/[0.025]'
                        }`}>
                          <button
                            onClick={() => toggleMember(m)}
                            className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2 text-left"
                          >
                            <MemberAvatar member={m} preferInitials={avatarPrefs.preferInitials} />
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
                          <button
                            onClick={() => setEditingMemberId(m.userId)}
                            title="Set initials, colours, shape and display name"
                            aria-label={`Edit how ${m.name ?? m.email} appears`}
                            className="px-3 py-2 text-white/40 hover:text-white/90 group-hover:text-white/70 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
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

/**
 * Inline editor for how one real member appears on this realm's boards.
 *
 * Each field is tri-state and the UI has to preserve that: an empty box means
 * "no override, derive it", which is a DELETE of that value rather than a write
 * of the empty string. The placeholder shows what the derived value would be,
 * so clearing a field is never a leap of faith.
 */
function MemberEditRow({
  member,
  preferInitials,
  onSave,
  onCancel,
}: {
  member: {
    userId: string
    name: string | null
    accountName?: string | null
    email: string
    image: string | null
    initials?: string | null
    color?: string | null
    textColor?: string | null
    shape?: string | null
  }
  preferInitials?: boolean
  onSave: (updates: ProfilePatch) => void
  onCancel: () => void
}) {
  const accountName = member.accountName ?? member.name
  const [initials, setInitials] = useState(member.initials ?? '')
  const [color, setColor] = useState(member.color ?? '')
  const [textColor, setTextColor] = useState(member.textColor ?? '')
  const [shape, setShape] = useState(member.shape ?? '')
  const [displayName, setDisplayName] = useState(
    member.name && member.name !== accountName ? member.name : '',
  )

  const derivedName = accountName ?? member.email.split('@')[0]
  const derivedInitials =
    getInitials(displayName.trim() || derivedName, '') || getInitialsFromEmail(member.email) || '?'

  const draft = {
    initials: initials.trim().slice(0, 4) || null,
    color: color || null,
    textColor: textColor || null,
    shape: shape || null,
  }

  const commit = () => {
    const nextName = displayName.trim() || null
    const updates: ProfilePatch = {}
    if (draft.initials !== (member.initials ?? null)) updates.initials = draft.initials
    if (draft.color !== (member.color ?? null)) updates.color = draft.color
    if (draft.textColor !== (member.textColor ?? null)) updates.textColor = draft.textColor
    if (draft.shape !== (member.shape ?? null)) updates.shape = draft.shape
    if (nextName !== (member.name && member.name !== accountName ? member.name : null)) {
      updates.displayName = nextName
    }
    if (Object.keys(updates).length === 0) return onCancel()
    onSave(updates)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
  }

  return (
    <div className="px-4 py-2.5 space-y-2.5 bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <MemberAvatar
          member={{ name: displayName.trim() || accountName, email: member.email, image: member.image, ...draft }}
          preferInitials={preferInitials}
        />
        <input
          autoFocus
          type="text"
          value={initials}
          maxLength={4}
          onChange={(e) => setInitials(e.target.value)}
          onKeyDown={onKey}
          placeholder={derivedInitials}
          aria-label="Initials"
          title="Up to 4 characters. Leave empty to derive from the name."
          className="w-14 px-2 py-1.5 text-[12px] text-center uppercase rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85 placeholder:text-white/25 placeholder:normal-case"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={onKey}
          placeholder={derivedName}
          aria-label="Display name"
          title="Shown instead of their account name on this realm's boards. Leave empty to use their own."
          className="flex-1 min-w-0 px-3 py-1.5 text-[12px] rounded-md bg-white/[0.03] border border-white/[0.06] focus:border-white/20 outline-none text-white/85 placeholder:text-white/25"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StyleField label="Fill">
          <ColorDots value={color} onChange={(c) => setColor(c === color ? '' : c)} />
          <HexSwatch value={color} fallback="#7c3aed" onChange={setColor} label="Any fill colour" />
          {color && <ClearButton onClick={() => setColor('')} label="Clear fill colour" />}
        </StyleField>
        <StyleField label="Text">
          <HexSwatch value={textColor} fallback="#ffffff" onChange={setTextColor} label="Initials colour" />
          {textColor
            ? <ClearButton onClick={() => setTextColor('')} label="Clear text colour" />
            : <span className="text-[10px] text-white/30">white</span>}
        </StyleField>
        <StyleField label="Shape">
          <ShapePicker value={shape} onChange={setShape} />
        </StyleField>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button onClick={onCancel} className="px-2 py-1 rounded-md text-[11px] text-white/45 hover:text-white/80 transition-colors">Cancel</button>
        <button
          onClick={commit}
          className="px-2.5 py-1 rounded-md text-[11px] bg-white/[0.06] border border-white/[0.1] text-white/80 hover:bg-white/[0.1] transition-colors"
        >
          Save
        </button>
      </div>
      {!preferInitials && member.image && !hasAvatarOverride(draft) && (
        <p className="text-[10px] text-white/35 leading-snug">
          This person has a profile picture. Anything you set here replaces it on this realm&rsquo;s boards;
          leave everything empty to keep the photo.
        </p>
      )}
    </div>
  )
}

function StyleField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-[0.14em] text-white/30 w-8">{label}</span>
      {children}
    </div>
  )
}

/**
 * The native colour input, dressed as one more dot. Its value must be a
 * #rrggbb, so an accent name is resolved to its hex for display, and picking
 * writes the raw hex back — which is what the validator accepts.
 */
function HexSwatch({ value, fallback, onChange, label }: { value: string; fallback: string; onChange: (hex: string) => void; label: string }) {
  const hex = resolveAccentHex(value || null, fallback)
  return (
    <span className="relative inline-flex w-4 h-4" title={label}>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-4 h-4 opacity-0 cursor-pointer"
      />
      <span
        className={`w-4 h-4 rounded-full border pointer-events-none ${value ? 'border-white/80 scale-110' : 'border-dashed border-white/40'}`}
        style={{ background: value ? hex : 'conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #a78bfa, #f87171)' }}
      />
    </span>
  )
}

function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="text-white/35 hover:text-white/80 transition-colors">
      <X className="w-3 h-3" />
    </button>
  )
}

const SHAPE_OPTIONS: { value: '' | 'rounded' | 'square'; label: string; cls: string }[] = [
  { value: '', label: 'Circle', cls: 'rounded-full' },
  { value: 'rounded', label: 'Rounded', cls: 'rounded-[28%]' },
  { value: 'square', label: 'Square', cls: 'rounded-none' },
]

function ShapePicker({ value, onChange }: { value: string; onChange: (shape: string) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Avatar shape">
      {SHAPE_OPTIONS.map((o) => {
        // '' and 'circle' are the same choice: the picker stores '' (derive)
        // but a row written elsewhere may hold the literal.
        const active = (value || 'circle') === (o.value || 'circle')
        return (
          <button
            key={o.label}
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={`w-4 h-4 border transition-transform ${o.cls} ${active ? 'bg-white/70 border-white/90 scale-110' : 'bg-white/15 border-white/30 hover:scale-105'}`}
          />
        )
      })}
    </div>
  )
}
