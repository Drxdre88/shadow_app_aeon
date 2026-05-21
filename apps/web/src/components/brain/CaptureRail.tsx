'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, Plus, BookOpen, Pin, Link as LinkIcon } from 'lucide-react'
import { createMemory } from '@/lib/actions/memories'

type Props = {
  onCaptured: () => void
  selectedMemoryId: string | null
}

export function CaptureRail({ onCaptured, selectedMemoryId }: Props) {
  return (
    <aside className="w-[180px] shrink-0 border-r border-white/[0.06] bg-black/30 backdrop-blur-md flex flex-col p-3 gap-2">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 pb-2">Capture</div>
      <NoteButton onCaptured={onCaptured} />
      <EodButton onCaptured={onCaptured} />
      <TalkButton disabled />
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 pt-4 pb-2">Selected</div>
      <RailButton icon={<Pin className="w-3.5 h-3.5" />} label="Pin" disabled={!selectedMemoryId} />
      <RailButton icon={<LinkIcon className="w-3.5 h-3.5" />} label="Link" disabled={!selectedMemoryId} />
      <div className="mt-auto text-[10px] text-white/30 leading-snug">
        ⌘⇧Space anywhere<br />opens Quick Capture
      </div>
    </aside>
  )
}

function NoteButton({ onCaptured }: { onCaptured: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <RailButton icon={<Plus className="w-3.5 h-3.5" />} label="Note" onClick={() => setOpen(true)} />
      {open && <InlineCapture kind="note" onClose={() => setOpen(false)} onCaptured={onCaptured} />}
    </>
  )
}

function EodButton({ onCaptured }: { onCaptured: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <RailButton icon={<BookOpen className="w-3.5 h-3.5" />} label="EOD reflect" onClick={() => setOpen(true)} />
      {open && <InlineCapture kind="eod" onClose={() => setOpen(false)} onCaptured={onCaptured} />}
    </>
  )
}

function TalkButton({ disabled }: { disabled?: boolean }) {
  return (
    <RailButton
      icon={<Mic className="w-3.5 h-3.5" />}
      label={disabled ? 'Talk (soon)' : 'Talk'}
      disabled={disabled}
    />
  )
}

function RailButton({
  icon, label, onClick, disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[11px] font-semibold text-white/70 hover:text-white bg-white/[0.04] hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
    >
      {icon}
      <span>{label}</span>
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
  const [open, setOpen] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (kind === 'note') {
        const body = note.trim()
        if (!body) return
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
          `**What's open**\n${open.trim()}`,
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
      onClose()
    } catch (err) {
      console.error(err)
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 p-2 rounded-lg bg-black/40 border border-white/[0.08]"
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
          <MiniField label="What's open" value={open} onChange={setOpen} />
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
