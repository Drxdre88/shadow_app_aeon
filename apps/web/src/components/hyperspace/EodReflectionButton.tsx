'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Moon, Check } from 'lucide-react'
import { AnchoredPopover } from '@/components/ui/AnchoredPopover'
import { createMemory, listMemoriesForUser } from '@/lib/actions/memories'
import { toast } from '@/components/ui/Toast'

function todayTag(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EodReflectionButton() {
  const [open, setOpen] = useState(false)
  const [todayCheck, setTodayCheck] = useState<{ day: string; present: boolean } | null>(null)
  const [happened, setHappened] = useState('')
  const [decided, setDecided] = useState('')
  const [stillOpen, setStillOpen] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const tag = todayTag()
    if (todayCheck && todayCheck.day === tag) return
    listMemoriesForUser({ type: 'reflection', limit: 20 })
      .then((rows) => {
        const present = rows.some((m) => Array.isArray(m.tags) && (m.tags as string[]).includes(tag))
        setTodayCheck({ day: tag, present })
      })
      .catch(() => setTodayCheck({ day: tag, present: false }))
  }, [open, todayCheck])

  const submit = async () => {
    if (submitting) return
    if (!happened.trim() && !decided.trim() && !stillOpen.trim()) {
      toast('Write at least one section before saving.', { force: true })
      return
    }
    setSubmitting(true)
    const tag = todayTag()
    const body = [
      happened.trim() && `## What happened\n\n${happened.trim()}`,
      decided.trim()  && `## What did I decide\n\n${decided.trim()}`,
      stillOpen.trim() && `## What's still open\n\n${stillOpen.trim()}`,
    ].filter(Boolean).join('\n\n')
    try {
      await createMemory({
        title: `EOD reflection · ${tag}`,
        bodyMd: body,
        type: 'reflection',
        source: 'manual',
        tags: ['eod', tag],
      })
      toast('EOD saved ✓', { force: true })
      setTodayCheck({ day: tag, present: true })
      setHappened('')
      setDecided('')
      setStillOpen('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save reflection', { force: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        title="End-of-day reflection"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Moon className="w-4 h-4" />
      </motion.button>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        icon={<Moon className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />}
        title={
          <>
            <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">End of Day</span>
            <span className="text-[10px] text-white/30 ml-1">{todayTag()}</span>
          </>
        }
      >
        <div className="p-4 flex flex-col gap-3">
          {todayCheck?.present ? (
            <div className="flex items-center gap-2 text-[12px] text-white/65 py-2">
              <Check className="w-3.5 h-3.5 text-emerald-300" />
              Reflected today. Add more if anything else surfaced.
            </div>
          ) : null}

          <Field label="What happened today?" value={happened} onChange={setHappened} />
          <Field label="What did I decide?"  value={decided}  onChange={setDecided} />
          <Field label="What's still open?"  value={stillOpen} onChange={setStillOpen} />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.18em] transition-all disabled:opacity-40"
              style={{
                background: 'color-mix(in oklab, var(--primary) 18%, transparent)',
                border: '1px solid color-mix(in oklab, var(--primary) 45%, transparent)',
                color: 'color-mix(in oklab, var(--primary) 22%, white)',
                boxShadow: '0 0 14px color-mix(in oklab, var(--primary) 25%, transparent)',
              }}
            >
              {submitting ? 'Saving…' : 'Save reflection'}
            </button>
          </div>
        </div>
      </AnchoredPopover>
    </>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="resize-none rounded-lg bg-black/30 border border-white/[0.08] focus:border-white/[0.22] outline-none px-2.5 py-1.5 text-[12.5px] text-white/85 placeholder:text-white/25"
        placeholder="…"
      />
    </label>
  )
}
