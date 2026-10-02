'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import type { AnsweredBy, BrainRoutineStatus } from '@/lib/kairos/routines/status-types'

export const ANSWER_TONE: Record<AnsweredBy, string> = {
  routine: 'var(--success)',
  backup: 'var(--warning)',
  missed: 'var(--error)',
}

export const ANSWER_WORD: Record<AnsweredBy, string> = {
  routine: 'on Max',
  backup: 'on backup',
  missed: 'missed',
}

export const ROUTINE_STATE: Record<BrainRoutineStatus['state'], { label: string; tone: string; hint: string }> = {
  live: { label: 'Live', tone: 'var(--success)', hint: 'Claiming work on schedule.' },
  silent: { label: 'Silent', tone: 'var(--warning)', hint: 'Set up, but nothing claimed in the last 26 hours.' },
  off: { label: 'Off', tone: 'var(--text-dim)', hint: 'Not set up yet.' },
}

export function tint(cssVar: string, pct: number): string {
  return `color-mix(in srgb, ${cssVar} ${pct}%, transparent)`
}

export function Dot({ tone, pulse }: { tone: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex w-2 h-2 shrink-0">
      {pulse && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: tone }}
          animate={{ scale: [1, 2.2], opacity: [0.55, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className="relative w-2 h-2 rounded-full" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />
    </span>
  )
}

export function Chip({ children, tone, mono }: { children: React.ReactNode; tone?: string; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md whitespace-nowrap border',
        mono ? 'font-mono text-[10.5px]' : 'uppercase tracking-[0.14em] text-[9.5px] font-medium',
        !tone && 'text-white/60 bg-white/[0.04] border-white/[0.08]',
      )}
      style={tone ? { color: tone, background: tint(tone, 10), borderColor: tint(tone, 35) } : undefined}
    >
      {children}
    </span>
  )
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return { copied, copy }
}

export function CopyAction({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const { copied, copy } = useCopy(text)
  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all border',
        !copied && !primary && 'text-white/70 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.10]',
        !copied && primary && 'text-white hover:brightness-125',
      )}
      style={
        copied
          ? { color: 'var(--success)', background: tint('var(--success)', 12), borderColor: tint('var(--success)', 40) }
          : primary
            ? { background: tint('var(--primary)', 18), borderColor: tint('var(--primary)', 55), boxShadow: '0 0 12px var(--glow-color)' }
            : undefined
      }
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { copied, copy } = useCopy(value)
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="w-24 shrink-0 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{label}</span>
      <span className={cn('flex-1 min-w-0 truncate text-[12.5px] text-white/90', mono && 'font-mono')} title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        aria-live="polite"
        className="flex items-center gap-1 text-[10.5px] text-white/45 hover:text-white/90 transition-colors"
        style={copied ? { color: 'var(--success)' } : undefined}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const { copied, copy } = useCopy(value)
  return (
    <div className="relative rounded-lg border border-white/[0.08] bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/35 font-mono">{lang}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${lang}`}
          aria-live="polite"
          className="flex items-center gap-1.5 text-[10px] text-white/45 hover:text-white/85 transition-colors"
          style={copied ? { color: 'var(--success)' } : undefined}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11.5px] leading-relaxed text-white/85 font-mono p-3.5 overflow-x-auto whitespace-pre">
        {value}
      </pre>
    </div>
  )
}

export function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold shrink-0"
          style={{
            border: '1px solid var(--primary)',
            color: 'var(--primary)',
            background: tint('var(--background)', 40),
            textShadow: '0 0 6px var(--glow-color)',
          }}
        >
          {number}
        </div>
        <h3 className="text-[13.5px] font-semibold text-white">{title}</h3>
      </div>
      <div className="flex flex-col gap-3 pl-9">{children}</div>
    </section>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-white/70">{children}</p>
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-[11.5px] font-mono text-white/90 bg-white/[0.06] border border-white/[0.08]">
      {children}
    </code>
  )
}

export function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-white/[0.08] overflow-hidden">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className={cn(
            'grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-[12px]',
            i % 2 === 0 && 'bg-white/[0.02]',
          )}
        >
          <div className="font-mono text-white/65 break-all">{k}</div>
          <div className="text-white/75">{v}</div>
        </div>
      ))}
    </div>
  )
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden', className)}>
      {children}
    </div>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{children}</div>
}

export function SegmentedSwitch<T extends string>({
  options, value, onChange, layoutId, size = 'md', label,
}: {
  options: { id: T; label: string; icon?: React.ComponentType<{ className?: string }> }[]
  value: T
  onChange: (id: T) => void
  layoutId: string
  size?: 'md' | 'sm'
  label: string
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.id === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % options.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex items-center gap-0.5 border border-white/[0.08] bg-white/[0.03] max-w-full overflow-x-auto',
        size === 'md' ? 'rounded-xl p-1' : 'rounded-lg p-0.5',
      )}
    >
      {options.map(({ id, label: text, icon: Icon }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              'relative flex items-center gap-1.5 font-medium transition-colors outline-none',
              'focus-visible:ring-1 focus-visible:ring-[color:var(--primary)]',
              size === 'md' ? 'px-3.5 py-1.5 text-[12px] rounded-lg' : 'px-2.5 py-1 text-[11px] rounded-md',
              active ? 'text-white' : 'text-white/50 hover:text-white/85',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className={cn('absolute inset-0 border', size === 'md' ? 'rounded-lg' : 'rounded-md')}
                style={{
                  background: tint('var(--primary)', 16),
                  borderColor: tint('var(--primary)', 45),
                  boxShadow: '0 0 14px var(--glow-color)',
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            {Icon && <Icon className="relative w-3.5 h-3.5" />}
            <span className="relative whitespace-nowrap">{text}</span>
          </button>
        )
      })}
    </div>
  )
}
