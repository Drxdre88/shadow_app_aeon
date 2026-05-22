'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, BookOpen, Pin, Link as LinkIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { createMemory } from '@/lib/actions/memories'
import { useKairosStore } from '@/stores/kairosStore'

// Sidebar middle section shown on /kairos — replaces the realm list with
// Kairos-specific actions (back arrow, capture controls, selected actions).
export function KairosSidebarContent({ collapsed }: { collapsed: boolean }) {
  const selectedMemoryId = useKairosStore((s) => s.selectedMemoryId)
  const triggerRefresh = useKairosStore((s) => s.triggerRefresh)

  return (
    <div className={cn('flex flex-col gap-1.5 px-2 py-2', collapsed && 'items-center px-1')}>
      <BackToHome collapsed={collapsed} />

      <Section label="Capture" collapsed={collapsed} />
      <NoteButton collapsed={collapsed} onCaptured={triggerRefresh} />
      <EodButton collapsed={collapsed} onCaptured={triggerRefresh} />

      <Section label="Selected" collapsed={collapsed} />
      <RailButton icon={<Pin className="w-3.5 h-3.5" />} label="Pin" disabled={!selectedMemoryId} collapsed={collapsed} />
      <RailButton icon={<LinkIcon className="w-3.5 h-3.5" />} label="Link" disabled={!selectedMemoryId} collapsed={collapsed} />
    </div>
  )
}

function BackToHome({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/dashboard"
      title="Back to dashboard"
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2 text-[11px] font-semibold text-white/55 hover:text-white hover:bg-white/[0.06] transition-all',
        collapsed && 'w-9 h-9 justify-center px-0 py-0',
      )}
    >
      <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap"
          >
            Dashboard
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

function Section({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return <div className="mt-2 mb-1 h-px w-6 bg-white/[0.06]" />
  }
  return (
    <div className="mt-3 mb-0.5 text-[9px] uppercase tracking-[0.24em] text-white/35 px-2">
      {label}
    </div>
  )
}

function NoteButton({ collapsed, onCaptured }: { collapsed: boolean; onCaptured: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <RailButton
        icon={<Plus className="w-3.5 h-3.5" />}
        label="Note"
        onClick={() => setOpen(true)}
        collapsed={collapsed}
      />
      {open && !collapsed && (
        <InlineCapture
          kind="note"
          onClose={() => setOpen(false)}
          onCaptured={() => { onCaptured(); setOpen(false) }}
        />
      )}
    </>
  )
}

function EodButton({ collapsed, onCaptured }: { collapsed: boolean; onCaptured: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <RailButton
        icon={<BookOpen className="w-3.5 h-3.5" />}
        label="EOD reflect"
        onClick={() => setOpen(true)}
        collapsed={collapsed}
      />
      {open && !collapsed && (
        <InlineCapture
          kind="eod"
          onClose={() => setOpen(false)}
          onCaptured={() => { onCaptured(); setOpen(false) }}
        />
      )}
    </>
  )
}

function RailButton({
  icon, label, onClick, disabled, collapsed,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  collapsed?: boolean
}) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-lg text-[11px] font-semibold transition-all',
        collapsed ? 'w-9 h-9 justify-center px-0 py-0' : 'w-full px-3 py-2',
        disabled
          ? 'text-white/30 cursor-not-allowed'
          : 'text-white/65 hover:text-white bg-white/[0.04] hover:bg-white/[0.10]',
      )}
    >
      {icon}
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

function InlineCapture({
  kind, onClose, onCaptured,
}: {
  kind: 'note' | 'eod'
  onClose: () => void
  onCaptured: () => void
}) {
  const [happened, setHappened] = useState('')
  const [decided, setDecided] = useState('')
  const [openItems, setOpenItems] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (kind === 'note') {
        const body = note.trim()
        if (!body) { setSaving(false); return }
        const firstLine = body.split('\n', 1)[0]
        await createMemory({
          title: firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine,
          bodyMd: body,
          type: 'note',
          source: 'manual',
        })
      } else {
        const today = new Date().toISOString().slice(0, 10)
        const body = [
          `**What happened**\n${happened.trim()}`,
          `**What did I decide**\n${decided.trim()}`,
          `**What's open**\n${openItems.trim()}`,
        ].join('\n\n')
        await createMemory({
          title: `EOD reflection — ${today}`,
          bodyMd: body,
          type: 'reflection',
          source: 'manual',
          tags: ['eod', today],
        })
      }
      onCaptured()
    } catch (err) {
      console.error(err)
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 p-2 rounded-lg bg-black/40 border border-white/[0.08] mx-1"
    >
      {kind === 'note' ? (
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Quick note…"
          rows={3}
          className="bg-transparent text-[12px] text-white/90 placeholder:text-white/30 outline-none resize-none"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit() }}
        />
      ) : (
        <>
          <MiniField label="What happened" value={happened} onChange={setHappened} autoFocus />
          <MiniField label="What did I decide" value={decided} onChange={setDecided} />
          <MiniField label="What's open" value={openItems} onChange={setOpenItems} />
        </>
      )}
      <div className="flex justify-end gap-1">
        <button
          onClick={onClose}
          className="px-2 py-1 text-[10px] text-white/40 hover:text-white/70"
        >Cancel</button>
        <button
          onClick={submit}
          disabled={saving}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-white/[0.10] hover:bg-white/[0.18] text-white/80 disabled:opacity-40"
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </motion.div>
  )
}

function MiniField({
  label, value, onChange, autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="bg-transparent text-[11px] text-white/85 placeholder:text-white/25 outline-none resize-none border-b border-white/[0.08] focus:border-white/[0.2]"
      />
    </div>
  )
}
