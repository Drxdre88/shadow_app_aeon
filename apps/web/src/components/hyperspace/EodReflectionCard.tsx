'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Moon, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { createMemory, listMemoriesForUser } from '@/lib/actions/memories'
import { toast } from '@/components/ui/Toast'

type Phase = 'checking' | 'hidden' | 'open' | 'done'

function todayTag(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EodReflectionCard() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [happened, setHappened] = useState('')
  const [decided, setDecided] = useState('')
  const [open, setOpen] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const now = new Date()
    if (now.getHours() < 18) {
      setPhase('hidden')
      return
    }
    // Look for an already-submitted reflection today.
    listMemoriesForUser({ type: 'reflection', limit: 20 })
      .then((rows) => {
        const tag = todayTag()
        const alreadyToday = rows.some((m) => Array.isArray(m.tags) && (m.tags as string[]).includes(tag))
        setPhase(alreadyToday ? 'done' : 'open')
      })
      .catch(() => setPhase('open'))
  }, [])

  const submit = async () => {
    if (submitting) return
    if (!happened.trim() && !decided.trim() && !open.trim()) {
      toast('Write at least one section before saving.', { force: true })
      return
    }
    setSubmitting(true)
    const tag = todayTag()
    const body = [
      happened.trim() && `## What happened\n\n${happened.trim()}`,
      decided.trim()  && `## What did I decide\n\n${decided.trim()}`,
      open.trim()     && `## What's still open\n\n${open.trim()}`,
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
      setPhase('done')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save reflection', { force: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'checking' || phase === 'hidden') return null

  if (phase === 'done') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-md px-4 py-2"
      >
        <span className="flex items-center gap-2 text-[12px] text-white/65">
          <Check className="w-3.5 h-3.5 text-emerald-300" />
          EOD reflected today
        </span>
        <Link href="/brain" className="text-[10px] uppercase tracking-[0.2em] text-white/40 hover:text-white/85 transition-colors">
          View in Cortex →
        </Link>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-xl p-4 sm:p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-white/75">
          <Moon className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
          <span className="text-[10px] uppercase tracking-[0.22em] text-white/55">End of Day Reflection</span>
        </div>
        <span className="text-[10px] text-white/30">{todayTag()}</span>
      </div>

      <ReflectionField
        label="What happened today?"
        value={happened}
        onChange={setHappened}
      />
      <ReflectionField
        label="What did I decide?"
        value={decided}
        onChange={setDecided}
      />
      <ReflectionField
        label="What's still open?"
        value={open}
        onChange={setOpen}
      />

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => setPhase('done')}
          className="px-3 py-1.5 rounded-md text-xs text-white/40 hover:text-white/75 hover:bg-white/[0.05]"
        >
          Skip today
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md bg-white/[0.10] hover:bg-white/[0.18] text-white/85 text-xs font-semibold disabled:opacity-40 transition-all"
        >
          {submitting ? 'Saving…' : 'Save reflection'}
        </button>
      </div>
    </motion.div>
  )
}

function ReflectionField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="resize-none rounded-md bg-black/30 border border-white/[0.06] focus:border-white/[0.18] outline-none px-2.5 py-1.5 text-[12.5px] text-white/85 placeholder:text-white/25"
        placeholder="…"
      />
    </label>
  )
}
