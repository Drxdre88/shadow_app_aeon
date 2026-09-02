'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { updateProjectSettings } from '@/lib/actions/projects'
import { toast } from '@/components/ui/Toast'
import { NeonButton } from '@/components/ui/NeonButton'
import {
  clampSizingValue,
  useBoardSizingStore,
  MAX_SIZING_LABELS,
  MIN_SIZING_VALUE,
  MAX_SIZING_VALUE,
  type BoardSizing,
  parseAvatarPrefs,
  useAvatarPrefsStore,
  type AvatarPrefs,
} from './sizing'

interface BoardSizingModalProps {
  isOpen: boolean
  projectId: string
  onClose: () => void
}

export function BoardSizingModal({ isOpen, projectId, onClose }: BoardSizingModalProps) {
  if (typeof document === 'undefined') return null

  // Portalled: the card modal wraps its content in a backdrop-filter element,
  // which would otherwise become the containing block for this fixed overlay
  // and trap it inside the card modal's box.
  return createPortal(
    <AnimatePresence>
      {isOpen && <SizingForm projectId={projectId} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  )
}

// Mounted only while open, so the draft seeds from the live config without an
// effect. Saves just the sizing key — updateProjectSettings merges server-side.
function SizingForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const sizing = useBoardSizingStore((s) => s.sizing)
  const setSizing = useBoardSizingStore((s) => s.setSizing)
  const [draft, setDraft] = useState<BoardSizing>(sizing)
  const avatarPrefs = useAvatarPrefsStore((s) => s.avatarPrefs)
  const setAvatarPrefs = useAvatarPrefsStore((s) => s.setAvatarPrefs)
  const [avatarDraft, setAvatarDraft] = useState<AvatarPrefs>(avatarPrefs)
  const [saving, setSaving] = useState(false)

  const updateLabel = (index: number, patch: { key?: string; value?: number }) => {
    setDraft((d) => ({
      ...d,
      labels: d.labels.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }))
  }

  const handleSave = async () => {
    const labels = draft.labels
      .map((l) => ({ key: l.key.trim().slice(0, 6), value: clampSizingValue(l.value) }))
      .filter((l) => l.key.length > 0)
    if (labels.length === 0) {
      toast('Add at least one size')
      return
    }
    const next: BoardSizing = { ...draft, labels }
    const previous = sizing
    const previousAvatars = avatarPrefs
    setSizing(next)
    setAvatarPrefs(avatarDraft)
    setSaving(true)
    try {
      // One write, two keys — updateProjectSettings shallow-merges, so sending
      // them separately would race and the loser would be silently reverted.
      await updateProjectSettings(projectId, { sizing: next, avatars: avatarDraft })
      onClose()
    } catch {
      setSizing(previous)
      setAvatarPrefs(previousAvatars)
      toast('Could not save sizing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-xl p-5 space-y-4',
          'bg-gradient-to-b from-white/10 to-black/40 backdrop-blur-md',
          'border border-white/10 shadow-[0_0_40px_color-mix(in_srgb,var(--primary)_30%,transparent)]'
        )}
      >
        <div>
          <h3 className="text-white font-medium">Task sizing</h3>
          <p className="text-xs text-slate-400 mt-1">
            Board-wide ladder. Each label maps to a number of {draft.unit} written to the card&apos;s size.
          </p>
        </div>

        <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
          <span>Enable sizing</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="w-4 h-4 accent-[var(--primary)]"
          />
        </label>

        <label className="flex items-start justify-between gap-3 text-sm text-slate-300">
          <span className="flex-1">
            Show initials instead of photos
            <span className="block text-xs text-slate-500 mt-0.5">
              Custom initials stay hidden behind a member&rsquo;s profile picture until this is on.
            </span>
          </span>
          <input
            type="checkbox"
            checked={avatarDraft.preferInitials}
            onChange={(e) => setAvatarDraft({ ...avatarDraft, preferInitials: e.target.checked })}
            className="w-4 h-4 mt-0.5 accent-[var(--primary)]"
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-300">Unit</span>
          <div className="flex gap-2">
            {(['days', 'points'] as const).map((unit) => (
              <button
                key={unit}
                onClick={() => setDraft({ ...draft, unit })}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs capitalize border transition-all',
                  draft.unit === unit
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                )}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
            <span className="w-20">Label</span>
            <span className="w-24">{draft.unit}</span>
          </div>
          {draft.labels.map((label, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={label.key}
                onChange={(e) => updateLabel(index, { key: e.target.value })}
                maxLength={6}
                placeholder="S"
                className="w-20 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/25"
              />
              <input
                type="number"
                value={label.value}
                step={0.5}
                min={MIN_SIZING_VALUE}
                max={MAX_SIZING_VALUE}
                onChange={(e) => updateLabel(index, { value: Number(e.target.value) })}
                className="w-24 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/25"
              />
              <span className="text-xs text-slate-500 flex-1">
                {label.key.trim() ? `${label.key.trim()} = ${label.value} ${draft.unit}` : ''}
              </span>
              <button
                onClick={() => setDraft({ ...draft, labels: draft.labels.filter((_, i) => i !== index) })}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Remove size"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {draft.labels.length < MAX_SIZING_LABELS && (
            <button
              onClick={() => setDraft({ ...draft, labels: [...draft.labels, { key: '', value: 1 }] })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 bg-white/5 border border-dashed border-white/20 hover:text-white hover:bg-white/10 transition-all"
            >
              <Plus className="w-3 h-3" />
              Add size
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all"
          >
            Cancel
          </button>
          <NeonButton onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </NeonButton>
        </div>
      </motion.div>
    </motion.div>
  )
}
