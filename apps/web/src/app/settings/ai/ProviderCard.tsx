'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, X, Eye, EyeOff, Loader2, Trash2, Zap, ExternalLink } from 'lucide-react'
import { PROVIDERS } from '@/lib/ai/providers'
import type { CredentialSummary } from '@/lib/data/ai-credentials'

export type TestResult = { ok: boolean; latencyMs: number; sample?: string; error?: string }

type ProviderCardProps = {
  provider: typeof PROVIDERS[number]
  tint: string
  cred: CredentialSummary | undefined
  draft: string
  revealed: boolean
  test: TestResult | null
  busy: boolean
  isActiveForBriefings: boolean
  onDraftChange: (v: string) => void
  onToggleReveal: () => void
  onTest: () => void
  onSave: () => void
  onRevoke: () => void
}

export function ProviderCard({
  provider, tint, cred, draft, revealed, test, busy, isActiveForBriefings,
  onDraftChange, onToggleReveal, onTest, onSave, onRevoke,
}: ProviderCardProps) {
  const ready = draft.trim().length >= 8

  return (
    <motion.div
      layout
      className="relative rounded-2xl overflow-hidden p-4"
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        border: `1px solid color-mix(in oklab, ${tint} ${cred ? 38 : 18}%, rgba(255,255,255,0.08))`,
        boxShadow: cred
          ? `0 0 24px color-mix(in oklab, ${tint} 18%, transparent), inset 0 1px 0 rgba(255,255,255,0.05)`
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {cred && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 w-40 h-40 rounded-full"
          style={{ background: `radial-gradient(circle, ${tint}55, transparent 70%)` }}
          animate={{ opacity: [0.4, 0.65, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                background: tint,
                boxShadow: cred ? `0 0 10px ${tint}` : 'none',
                opacity: cred ? 1 : 0.5,
              }}
            />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-white/90">{provider.label}</div>
              <div className="text-[10px] text-white/35 mt-0.5 truncate">
                {cred ? (cred.keyHint ?? '••••') : provider.keyPrefix + '…'}
              </div>
            </div>
          </div>

          {cred ? (
            <div className="flex flex-col items-end gap-1">
              {isActiveForBriefings && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] uppercase tracking-[0.18em] font-medium"
                  style={{
                    background: `color-mix(in oklab, ${tint} 18%, transparent)`,
                    border: `1px solid ${tint}66`,
                    color: `color-mix(in oklab, ${tint} 25%, white)`,
                  }}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Active
                </span>
              )}
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-white/40"
                title={`Added ${new Date(cred.createdAt).toLocaleString()}`}
              >
                <Check className="w-2.5 h-2.5" style={{ color: tint }} />
                Wired
              </span>
            </div>
          ) : (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-white/45 hover:text-white/85 transition-colors"
            >
              Get key
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>

        <div
          className="flex items-center rounded-xl overflow-hidden mb-2"
          style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <input
            type={revealed ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder={cred ? 'Paste a new key to rotate…' : `Paste ${provider.keyPrefix}… key`}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            className="flex-1 px-3 py-2.5 text-[12px] bg-transparent outline-none font-mono text-white/85 placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={onToggleReveal}
            className="px-2.5 py-2.5 text-white/35 hover:text-white/85"
            title={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={onTest}
            disabled={busy || !ready}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.18em] rounded-lg border border-white/[0.10] hover:border-white/[0.25] hover:bg-white/[0.04] text-white/65 hover:text-white disabled:opacity-30 transition-colors"
          >
            {busy && test === null ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Test
          </button>
          <button
            onClick={onSave}
            disabled={busy || !ready}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.18em] rounded-lg transition-all disabled:opacity-30"
            style={{
              background: ready ? `color-mix(in oklab, ${tint} 22%, transparent)` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${ready ? `color-mix(in oklab, ${tint} 55%, transparent)` : 'rgba(255,255,255,0.10)'}`,
              color: ready ? `color-mix(in oklab, ${tint} 25%, white)` : 'rgba(255,255,255,0.55)',
              boxShadow: ready ? `0 0 14px color-mix(in oklab, ${tint} 30%, transparent)` : 'none',
            }}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : cred ? 'Rotate' : 'Save'}
          </button>
          <div className="flex-1" />
          {cred && (
            <button
              onClick={onRevoke}
              disabled={busy}
              title="Revoke key"
              className="p-1.5 rounded-lg text-white/35 hover:text-rose-300 hover:bg-rose-500/[0.08] transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <AnimatePresence>
          {test && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{
                background: test.ok ? `color-mix(in oklab, ${tint} 8%, transparent)` : 'rgba(244,63,94,0.08)',
                border: `1px solid ${test.ok ? `color-mix(in oklab, ${tint} 30%, transparent)` : 'rgba(244,63,94,0.30)'}`,
                color: test.ok ? `color-mix(in oklab, ${tint} 30%, white)` : 'rgb(254,205,211)',
              }}
            >
              {test.ok ? <Check className="w-3 h-3 shrink-0" /> : <X className="w-3 h-3 shrink-0" />}
              <span className="truncate">
                {test.ok ? `${test.latencyMs}ms · "${test.sample}"` : test.error}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
