'use client'

import { Children, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ExternalLink, CornerDownRight, LifeBuoy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { Tick } from './setupProgress'
import { tint } from './brainUi'

const TICK_WORD: Record<Tick, string> = { done: 'Done', todo: 'Not yet', unknown: '' }

export function SetupStep({
  marker, title, meta, tick, open, onToggle, children, note,
}: {
  marker: React.ReactNode
  title: string
  meta?: string
  tick: Tick
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  note?: string
}) {
  const done = tick === 'done'
  const bodyId = `setup-step-${title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div data-tick={tick}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-3.5 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors outline-none focus-visible:bg-white/[0.04]"
      >
        <StepMarker done={done} dim={tick === 'unknown'}>{marker}</StepMarker>
        <div className="min-w-0 flex-1">
          <div className={cn('text-[13.5px] font-semibold', done ? 'text-white/70' : 'text-white')}>{title}</div>
          {(meta || note) && (
            <div className="mt-0.5 text-[11px] text-white/45 truncate">{note ?? meta}</div>
          )}
        </div>
        {TICK_WORD[tick] && (
          <span
            className="text-[10.5px] font-medium shrink-0"
            style={{ color: done ? 'var(--success)' : 'var(--text-dim)' }}
          >
            {TICK_WORD[tick]}
          </span>
        )}
        <ChevronDown className={cn('w-4 h-4 text-white/35 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 pl-[3.25rem] pr-5 pb-5">
              {meta && note && <div className="text-[11px] text-white/45">{meta}</div>}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepMarker({ done, dim, children }: { done: boolean; dim: boolean; children: React.ReactNode }) {
  const tone = done ? 'var(--success)' : dim ? 'var(--text-dim)' : 'var(--primary)'
  return (
    <span
      aria-hidden
      className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[11.5px] font-semibold border"
      style={{
        color: tone,
        borderColor: tint(tone, done ? 60 : 55),
        background: tint(tone, done ? 16 : 6),
        boxShadow: done ? `0 0 10px ${tint(tone, 40)}` : undefined,
      }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : children}
    </span>
  )
}

export function Actions({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children)
  return (
    <ol className="flex flex-col gap-3">
      {items.map((child, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-4 shrink-0 pt-px text-[11.5px] font-semibold tabular-nums" style={{ color: 'var(--primary)' }}>
            {i + 1}.
          </span>
          <div className="min-w-0 flex-1 flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-white/75">{child}</div>
        </li>
      ))}
    </ol>
  )
}

export function Act({ where, children }: { where?: string; children: React.ReactNode }) {
  return (
    <p>
      {where && <span className="text-white/95 font-medium">{where}, </span>}
      {children}
    </p>
  )
}

export function Expect({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-[12px] leading-relaxed text-white/55">
      <CornerDownRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
      <span>{children}</span>
    </p>
  )
}

export function B({ children }: { children: React.ReactNode }) {
  return <b className="text-white/95 font-medium">{children}</b>
}

export function PrimaryLink({ href, children, icon }: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white border transition hover:brightness-125"
      style={{
        background: tint('var(--primary)', 22),
        borderColor: tint('var(--primary)', 60),
        boxShadow: '0 0 16px var(--glow-color)',
      }}
    >
      {icon}
      {children}
      <ExternalLink className="w-3.5 h-3.5 opacity-70" />
    </a>
  )
}

export function Disclosure({
  label, children, icon, defaultOpen = false,
}: {
  label: string
  children: React.ReactNode
  icon?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[11.5px] font-medium text-white/60 hover:text-white/90 transition-colors outline-none focus-visible:text-white"
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="flex flex-col gap-3 px-3.5 pb-3.5">{children}</div>}
    </div>
  )
}

export function Troubleshoot({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <Disclosure label="Not working?" icon={<LifeBuoy className="w-3.5 h-3.5" />}>
      <dl className="flex flex-col gap-2.5">
        {items.map(([problem, fix]) => (
          <div key={problem} className="text-[12px] leading-relaxed">
            <dt className="text-white/85 font-medium">{problem}</dt>
            <dd className="text-white/55">{fix}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  )
}

export function CheckAgain({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium text-white/75 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] transition disabled:opacity-60"
    >
      {busy ? 'Checking…' : 'Check again'}
    </button>
  )
}
