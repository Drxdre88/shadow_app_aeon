'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, ArrowRight, KeyRound } from 'lucide-react'
import { motion } from 'framer-motion'
import { getTodaysBriefings } from '@/lib/actions/memories'

// Kairos Phase 1.5 — DailyBriefingCard reads from Briefer-generated
// advisories (memory.type='advisory', source='cron'). One advisory per
// Dominion per day. When no advisories exist (BYOK not set, cron not run
// yet) we show a small Enable AI CTA pointing to /settings/ai instead of
// dumping the raw retrieval bundle.

type Advisory = {
  id: string
  title: string
  bodyMd: string
  createdAt: Date | string
  dominionId: string | null
  dominionName: string | null
  dominionColor: string | null
}

type CtaBriefing = {
  kind: 'cta'
}

type AdvisoryBriefing = {
  kind: 'advisories'
  advisories: Advisory[]
}

type Briefing = AdvisoryBriefing | CtaBriefing

const CACHE_KEY = (day: string) => `aeon.kairos.briefing.${day}`

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DailyBriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBriefing = async (force = false) => {
    setLoading(true)
    setError(null)
    const day = todayKey()
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY(day))
        if (cached) {
          setBriefing(JSON.parse(cached) as Briefing)
          setLoading(false)
          return
        }
      } catch {
        // corrupt cache → refetch
      }
    }

    try {
      const advisories = await getTodaysBriefings()
      if (advisories.length > 0) {
        const next: AdvisoryBriefing = { kind: 'advisories', advisories }
        setBriefing(next)
        try { localStorage.setItem(CACHE_KEY(day), JSON.stringify(next)) } catch {}
      } else {
        setBriefing({ kind: 'cta' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBriefing() }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-xl p-4 sm:p-5 overflow-hidden"
      style={{ boxShadow: '0 0 0 1px rgba(139,92,246,0.10), 0 12px 40px rgba(0,0,0,0.35)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background: 'radial-gradient(circle at 90% 10%, rgba(139,92,246,0.18), transparent 50%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
            <span className="text-[10px] uppercase tracking-[0.22em] text-white/55">Daily Briefing</span>
            {briefing?.kind === 'advisories' && (
              <span className="text-[10px] text-white/35">· {briefing.advisories.length} Dominion{briefing.advisories.length === 1 ? '' : 's'}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchBriefing(true)}
              disabled={loading}
              title="Refresh briefing"
              className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06] disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-white/40 py-4">Loading briefing…</div>
        ) : error ? (
          <div className="text-sm text-rose-300 py-2">{error}</div>
        ) : briefing?.kind === 'advisories' ? (
          <div className="max-h-[420px] overflow-y-auto pr-1 flex flex-col gap-4">
            {briefing.advisories.map((a) => (
              <AdvisorySection key={a.id} advisory={a} />
            ))}
            <Link
              href="/kairos"
              className="mt-1 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-white/45 hover:text-white/85 transition-colors w-fit"
            >
              Open Kairos <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : briefing?.kind === 'cta' ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  background: 'color-mix(in oklab, var(--primary) 18%, transparent)',
                  boxShadow: '0 0 16px color-mix(in oklab, var(--primary) 30%, transparent)',
                }}
              >
                <KeyRound className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <div className="text-[13px] text-white/90 font-medium">Enable AI to start your briefings</div>
                <div className="text-[11px] text-white/45 mt-0.5">Bring your own Anthropic, OpenAI, or Gemini key. Stored encrypted, used only for your briefings.</div>
              </div>
            </div>
            <Link
              href="/settings/ai"
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg border border-white/[0.12] hover:border-white/30 hover:bg-white/[0.04] transition-colors"
              style={{ color: 'var(--primary)' }}
            >
              Configure AI <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

function AdvisorySection({ advisory }: { advisory: Advisory }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        {advisory.dominionName && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-md uppercase tracking-[0.18em] font-medium"
            style={{
              background: `color-mix(in oklab, var(--${advisory.dominionColor ?? 'primary'}, var(--primary)) 18%, transparent)`,
              color: `color-mix(in oklab, var(--${advisory.dominionColor ?? 'primary'}, var(--primary)) 80%, white)`,
            }}
          >
            {advisory.dominionName}
          </span>
        )}
        <Link
          href={`/kairos?focus=${advisory.id}`}
          className="text-[10px] text-white/35 hover:text-white/80 transition-colors"
        >
          open →
        </Link>
      </div>
      <BriefingProse markdown={advisory.bodyMd} />
    </div>
  )
}

// Lean markdown renderer — the Briefer produces controlled output (## sections,
// short paragraphs, occasional lists). No need for a full markdown engine.
function BriefingProse({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n')
  const out: React.ReactNode[] = []
  let key = 0

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { out.push(<div key={key++} className="h-2" />); continue }
    if (line.startsWith('# '))   { out.push(<h2 key={key++} className="text-sm font-semibold text-white/95 mt-1 mb-1">{line.slice(2)}</h2>); continue }
    if (line.startsWith('## '))  { out.push(<h3 key={key++} className="text-[11px] uppercase tracking-[0.2em] text-white/45 mt-3 mb-1">{line.slice(3)}</h3>); continue }
    if (line.startsWith('### ')) { out.push(<h4 key={key++} className="text-[12px] font-semibold text-white/85 mt-2">{line.slice(4)}</h4>); continue }
    if (line.startsWith('> '))   { out.push(<div key={key++} className="text-[10px] text-white/40 italic">{line.slice(2)}</div>); continue }
    if (line.startsWith('- '))   { out.push(<li key={key++} className="text-[12px] text-white/70 ml-4 list-disc marker:text-white/30">{line.slice(2)}</li>); continue }
    if (line === '---')          { out.push(<div key={key++} className="h-px bg-white/[0.04] my-1" />); continue }
    if (line.startsWith('*') && line.endsWith('*')) {
      out.push(<div key={key++} className="text-[10px] text-white/35 italic">{line.slice(1, -1)}</div>)
      continue
    }
    out.push(<p key={key++} className="text-[12px] text-white/75 leading-relaxed">{line}</p>)
  }

  return <div className="flex flex-col gap-0.5">{out}</div>
}
