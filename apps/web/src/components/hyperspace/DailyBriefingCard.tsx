'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { prepareContextForUser } from '@/lib/actions/memories'

type Briefing = {
  contextMd: string
  tokensUsed: number
  sources: { id: string; title: string; score: number; section: string }[]
}

const CACHE_KEY = (day: string) => `aeon.brain.briefing.${day}`

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DailyBriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)

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
        // ignore — corrupt cache, refetch.
      }
    }
    try {
      const res = await prepareContextForUser({
        query: 'what should I focus on today',
        budgetTokens: 1500,
        maxSources: 12,
        hops: 1,
        includePinned: true,
      })
      // No memories — show empty briefing state and skip caching.
      if (!res.sources.length) {
        setSkipped(true)
        setBriefing(null)
      } else {
        setBriefing(res)
        try { localStorage.setItem(CACHE_KEY(day), JSON.stringify(res)) } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBriefing()
  }, [])

  if (skipped) return null

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
          </div>
          <div className="flex items-center gap-2">
            {briefing && (
              <span className="text-[10px] text-white/30">{briefing.tokensUsed} tokens</span>
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
        ) : briefing ? (
          <>
            <BriefingProse markdown={briefing.contextMd} />
            {briefing.sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/[0.05] flex flex-wrap gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/35 mr-1">Sources</span>
                {briefing.sources.slice(0, 8).map((s) => (
                  <Link
                    key={s.id}
                    href={`/kairos?focus=${s.id}`}
                    title={`Open in Kairos · ${s.section}`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/55 hover:bg-white/[0.10] hover:text-white/90 transition-colors"
                  >
                    {s.title.length > 36 ? s.title.slice(0, 33) + '…' : s.title}
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </motion.div>
  )
}

// Stripped-down markdown render — `prepare_context` produces a controlled
// shape (#/##/###/lists/citation block). We don't need a full markdown engine
// here; classify by leading sigil and style accordingly.
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

  // The trailing "## Sources" block is rendered as chips above — strip it
  // from the prose stream visually if present.
  const sourcesIdx = out.findIndex((n) => typeof n === 'object' && n !== null && (n as { props?: { children?: string } }).props?.children === 'Sources')
  const head = sourcesIdx >= 0 ? out.slice(0, sourcesIdx) : out

  return (
    <div className="max-h-[320px] overflow-y-auto pr-1 flex flex-col gap-0.5">
      {head}
      <Link
        href="/kairos"
        className="mt-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-white/45 hover:text-white/85 transition-colors w-fit"
      >
        Open Kairos <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  )
}
