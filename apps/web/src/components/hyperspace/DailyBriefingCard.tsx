'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, ArrowRight, KeyRound, Wand2, Loader2, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { getTodaysBriefings, runBriefingNow } from '@/lib/actions/memories'
import { hasAiCredentials } from '@/lib/actions/ai-credentials'
import type { CredentialPresence } from '@/lib/data/ai-credentials'
import { PROVIDER_UI } from '@/lib/ai/providers-ui'

type Advisory = {
  id: string
  title: string
  bodyMd: string
  createdAt: Date | string
  dominionId: string | null
  dominionName: string | null
  dominionColor: string | null
}

const PROVIDER_PILLS = PROVIDER_UI

const CACHE_KEY = (day: string) => `aeon.kairos.briefing.${day}`

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function isAdvisoryShape(value: unknown): value is Advisory {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.title === 'string' && typeof v.bodyMd === 'string'
}

export function DailyBriefingCard() {
  const [advisories, setAdvisories] = useState<Advisory[] | null>(null)
  const [presence, setPresence] = useState<CredentialPresence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState<string | null>(null)

  const fetchBriefing = async (force = false) => {
    setLoading(true)
    setError(null)
    const day = todayKey()

    let cachedAdvisories: Advisory[] | null = null
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY(day))
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.every(isAdvisoryShape)) {
            cachedAdvisories = parsed as Advisory[]
          } else {
            localStorage.removeItem(CACHE_KEY(day))
          }
        }
      } catch {
        try { localStorage.removeItem(CACHE_KEY(day)) } catch {}
      }
    }

    try {
      const [freshAdvisories, freshPresence] = await Promise.all([
        cachedAdvisories ? Promise.resolve(cachedAdvisories) : getTodaysBriefings(),
        hasAiCredentials(),
      ])
      setAdvisories(freshAdvisories)
      setPresence(freshPresence)
      if (!cachedAdvisories && freshAdvisories.length > 0) {
        try { localStorage.setItem(CACHE_KEY(day), JSON.stringify(freshAdvisories)) } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBriefing() }, [])

  const generate = async () => {
    if (generating) return
    setGenerating(true)
    setGenStatus(null)
    setError(null)
    try {
      const res = await runBriefingNow()
      try { localStorage.removeItem(CACHE_KEY(todayKey())) } catch {}
      if (res.ran === 0) {
        setGenStatus('No Dominions yet — create one in Kairos first.')
      } else if (res.created === 0 && res.existing === 0 && res.skipped.length > 0) {
        const first = res.skipped[0]
        setGenStatus(`Skipped: ${first.reason}${res.skipped.length > 1 ? ` (+${res.skipped.length - 1})` : ''}`)
      } else if (res.created === 0 && res.existing > 0) {
        setGenStatus(`Already briefed today (${res.existing} Dominion${res.existing === 1 ? '' : 's'}).`)
        await fetchBriefing(true)
      } else {
        setGenStatus(`Brief generated for ${res.created} Dominion${res.created === 1 ? '' : 's'}.`)
        await fetchBriefing(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Briefing failed')
    } finally {
      setGenerating(false)
    }
  }

  const hasAdvisories = (advisories?.length ?? 0) > 0
  const hasKey = presence?.hasAny === true
  const showCta = !loading && !error && !hasKey

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
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--primary)' }} />
            <span className="text-[10px] uppercase tracking-[0.22em] text-white/55">Daily Briefing</span>
            {hasAdvisories && (
              <span className="text-[10px] text-white/35">· {advisories!.length} Dominion{advisories!.length === 1 ? '' : 's'}</span>
            )}
            {presence && <ProviderPills presence={presence} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {genStatus && (
              <span className="text-[10px] text-white/45 truncate max-w-[200px]" title={genStatus}>{genStatus}</span>
            )}
            {hasKey && (
              <button
                onClick={generate}
                disabled={generating || loading}
                title="Run briefing now"
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.18em] rounded-md border border-white/[0.10] hover:border-white/[0.25] hover:bg-white/[0.04] text-white/70 hover:text-white/95 disabled:opacity-40 transition-colors"
                style={{ color: generating ? undefined : 'var(--primary)' }}
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {generating ? 'Briefing…' : 'Run now'}
              </button>
            )}
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
        ) : hasAdvisories ? (
          <div className="max-h-[420px] overflow-y-auto pr-1 flex flex-col gap-4">
            {advisories!.map((a) => (
              <AdvisorySection key={a.id} advisory={a} />
            ))}
            <Link
              href="/kairos"
              className="mt-1 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-white/45 hover:text-white/85 transition-colors w-fit"
            >
              Open Kairos <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : hasKey ? (
          <div className="text-[12px] text-white/55 leading-relaxed py-2">
            No briefing yet today. Hit <span className="text-white/80">Run now</span> to generate one for each active Dominion.
          </div>
        ) : showCta ? (
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

function ProviderPills({ presence }: { presence: CredentialPresence }) {
  return (
    <div className="flex items-center gap-1.5 ml-1">
      {PROVIDER_PILLS.map((p) => {
        const configured = presence.configured.includes(p.id)
        const active = presence.activeProvider === p.id
        const baseStyle: React.CSSProperties = configured
          ? {
              background: `color-mix(in oklab, ${p.tint} ${active ? 16 : 8}%, rgba(255,255,255,0.02))`,
              border: `1px solid color-mix(in oklab, ${p.tint} ${active ? 50 : 24}%, transparent)`,
              color: `color-mix(in oklab, ${p.tint} ${active ? 35 : 55}%, white)`,
              opacity: 1,
            }
          : {
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.35)',
              opacity: 0.65,
            }
        const title = configured
          ? active
            ? `${p.label} — active for briefings`
            : `${p.label} — key wired (not active for briefings)`
          : `${p.label} — not configured. Add a key in Settings → AI.`
        return (
          <span
            key={p.id}
            title={title}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] uppercase tracking-[0.14em]"
            style={baseStyle}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: configured ? p.tint : 'rgba(255,255,255,0.18)',
                boxShadow: active ? `0 0 6px ${p.tint}` : 'none',
              }}
            />
            {p.label}
            {active && <Check className="w-2.5 h-2.5" style={{ color: p.tint }} />}
          </span>
        )
      })}
    </div>
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
