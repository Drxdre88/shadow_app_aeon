'use client'

import { useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  KeyRound, Check, X, Eye, EyeOff, Loader2, Trash2, Zap,
  ShieldCheck, ExternalLink, Sparkles,
} from 'lucide-react'
import { PROVIDERS, type ProviderId, type AiTier } from '@/lib/ai/providers'
import {
  saveCredential,
  deleteCredential,
  testCandidateKey,
  savePreferences,
} from '@/lib/actions/ai-credentials'
import type { CredentialSummary, PreferenceShape } from '@/lib/data/ai-credentials'

type Props = {
  initialCredentials: CredentialSummary[]
  initialPreferences: PreferenceShape
}

type TestResult = { ok: boolean; latencyMs: number; sample?: string; error?: string }

const TIER_INFO: Record<AiTier, { label: string; hint: string; icon: typeof Sparkles }> = {
  cheap:    { label: 'Cheap',    hint: 'Auto-tag, link suggestions, classification', icon: Sparkles },
  standard: { label: 'Standard', hint: 'Reflections, code, shell, summaries',         icon: Zap },
  heavy:    { label: 'Heavy',    hint: 'Briefings, advisories, deep work',            icon: Sparkles },
}

const PROVIDER_TINT: Record<ProviderId, string> = {
  anthropic: '#c97e4a',
  openai:    '#10a37f',
  google:    '#4f8df7',
}

export default function AiSettingsClient({ initialCredentials, initialPreferences }: Props) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>(initialCredentials)
  const [preferences, setPreferences] = useState<PreferenceShape>(initialPreferences)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({ anthropic: '', openai: '', google: '' })
  const [reveal, setReveal] = useState<Record<ProviderId, boolean>>({ anthropic: false, openai: false, google: false })
  const [testResults, setTestResults] = useState<Record<ProviderId, TestResult | null>>({ anthropic: null, openai: null, google: null })
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const credentialByProvider = Object.fromEntries(credentials.map((c) => [c.provider, c])) as Record<string, CredentialSummary>
  const heavyProvider = preferences.heavy.providerId as ProviderId
  const totalWired = credentials.length

  async function handleSave(providerId: ProviderId) {
    const apiKey = drafts[providerId].trim()
    if (apiKey.length < 8) { setError('Key looks too short'); return }
    setError(null)
    setBusyProvider(providerId)
    try {
      const row = await saveCredential({ provider: providerId, label: `${providerId} key`, apiKey })
      setCredentials((rows) => [row, ...rows.filter((r) => r.provider !== providerId)])
      setDrafts((d) => ({ ...d, [providerId]: '' }))
      setTestResults((r) => ({ ...r, [providerId]: null }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyProvider(null)
    }
  }

  async function handleTest(providerId: ProviderId) {
    const apiKey = drafts[providerId].trim()
    if (apiKey.length < 8) { setError('Paste a key first'); return }
    setError(null)
    setBusyProvider(providerId)
    try {
      const result = await testCandidateKey({ provider: providerId, apiKey })
      setTestResults((r) => ({ ...r, [providerId]: result }))
    } catch (err) {
      setTestResults((r) => ({ ...r, [providerId]: { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : 'Test failed' } }))
    } finally {
      setBusyProvider(null)
    }
  }

  async function handleRevoke(id: string, providerId: ProviderId) {
    if (!confirm(`Revoke ${providerId} key? AI features using this provider will stop working.`)) return
    setBusyProvider(providerId)
    try {
      await deleteCredential(id)
      setCredentials((rows) => rows.filter((r) => r.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    } finally {
      setBusyProvider(null)
    }
  }

  function updateTier(tier: AiTier, providerId: ProviderId, modelId: string) {
    setPreferences((p) => ({ ...p, [tier]: { providerId, modelId } }))
  }

  function persistPreferences() {
    startTransition(async () => {
      try {
        await savePreferences(preferences)
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  return (
    <div className="relative min-h-full text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 py-10">
        <header className="flex items-end justify-between gap-6 mb-10 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
              <span className="text-[10px] uppercase tracking-[0.28em] text-white/55">AI Integration</span>
            </div>
            <h1 className="text-3xl font-light tracking-tight">Wire your providers.</h1>
            <p className="text-[13px] text-white/45 mt-2 max-w-xl leading-relaxed">
              Bring your own keys. Pick which model runs each tier. Kairos picks up the change the next time it thinks.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <StatusChip
              icon={<ShieldCheck className="w-3 h-3" />}
              label="Encrypted at rest"
              tone="quiet"
            />
            <StatusChip
              icon={<KeyRound className="w-3 h-3" />}
              label={totalWired === 0 ? 'No keys wired' : `${totalWired} key${totalWired === 1 ? '' : 's'} wired`}
              tone={totalWired === 0 ? 'warn' : 'primary'}
            />
          </div>
        </header>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-6 px-4 py-3 rounded-xl border text-[12px]"
              style={{ borderColor: 'rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.08)', color: 'rgb(254,205,211)' }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <section className="mb-10">
          <SectionTitle
            label="Provider keys"
            hint="Paste a key, test it, save. We never see it again — it's encrypted before storage."
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {PROVIDERS.map((p) => {
              const cred = credentialByProvider[p.id]
              const test = testResults[p.id]
              const busy = busyProvider === p.id
              const isActiveForBriefings = cred && heavyProvider === p.id
              const tint = PROVIDER_TINT[p.id]
              return (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  tint={tint}
                  cred={cred}
                  draft={drafts[p.id]}
                  revealed={reveal[p.id]}
                  test={test}
                  busy={busy}
                  isActiveForBriefings={!!isActiveForBriefings}
                  onDraftChange={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
                  onToggleReveal={() => setReveal((r) => ({ ...r, [p.id]: !r[p.id] }))}
                  onTest={() => handleTest(p.id)}
                  onSave={() => handleSave(p.id)}
                  onRevoke={() => cred && handleRevoke(cred.id, p.id)}
                />
              )
            })}
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
            <SectionTitle
              label="Tier routing"
              hint="Kairos picks a tier per task. Choose which provider and model serves each."
              compact
            />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={persistPreferences}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[11px] uppercase tracking-[0.22em] rounded-lg transition-all duration-200 disabled:opacity-40"
              style={{
                background: savedFlash
                  ? 'color-mix(in oklab, var(--primary) 28%, transparent)'
                  : 'color-mix(in oklab, var(--primary) 16%, transparent)',
                border: '1px solid color-mix(in oklab, var(--primary) 50%, transparent)',
                color: 'color-mix(in oklab, var(--primary) 20%, white)',
                boxShadow: savedFlash
                  ? '0 0 24px color-mix(in oklab, var(--primary) 45%, transparent)'
                  : '0 0 12px color-mix(in oklab, var(--primary) 20%, transparent)',
              }}
            >
              {savedFlash ? <Check className="w-3 h-3" /> : pending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {savedFlash ? 'Saved' : pending ? 'Saving…' : 'Save preferences'}
            </motion.button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['cheap', 'standard', 'heavy'] as AiTier[]).map((tier) => {
              const sel = preferences[tier]
              const provider = PROVIDERS.find((p) => p.id === sel.providerId) ?? PROVIDERS[0]
              const tint = PROVIDER_TINT[sel.providerId as ProviderId] ?? '#888'
              const hasKey = !!credentialByProvider[sel.providerId]
              const Icon = TIER_INFO[tier].icon
              return (
                <div
                  key={tier}
                  className="relative rounded-2xl p-4 overflow-hidden transition-all duration-300"
                  style={{
                    background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                    border: `1px solid color-mix(in oklab, ${tint} 22%, rgba(255,255,255,0.08))`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px color-mix(in oklab, ${tint} 10%, transparent)`,
                  }}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-40"
                    style={{ background: `radial-gradient(circle, ${tint}33, transparent 70%)` }}
                  />
                  <div className="relative flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3 h-3" style={{ color: tint }} />
                      <span className="text-[10px] uppercase tracking-[0.22em] text-white/70 font-medium">{TIER_INFO[tier].label}</span>
                    </div>
                    {!hasKey && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] uppercase tracking-[0.16em]"
                        style={{
                          background: 'rgba(244,63,94,0.10)',
                          border: '1px dashed rgba(244,63,94,0.35)',
                          color: 'rgb(254,205,211)',
                        }}
                      >
                        no key
                      </span>
                    )}
                  </div>

                  <div className="relative text-[11px] text-white/50 mb-4 leading-relaxed">
                    {TIER_INFO[tier].hint}
                  </div>

                  <div className="relative flex flex-col gap-2">
                    <select
                      value={sel.providerId}
                      onChange={(e) => {
                        const nextProvider = e.target.value as ProviderId
                        const firstModel = PROVIDERS.find((p) => p.id === nextProvider)?.models[0]?.id ?? sel.modelId
                        updateTier(tier, nextProvider, firstModel)
                      }}
                      className="w-full px-3 py-2 text-[12px] rounded-lg bg-black/30 border border-white/10 focus:border-white/30 outline-none cursor-pointer"
                      style={{ color: tint }}
                    >
                      {PROVIDERS.map((p) => <option key={p.id} value={p.id} className="bg-[#0a0612]">{p.label}</option>)}
                    </select>
                    <select
                      value={sel.modelId}
                      onChange={(e) => updateTier(tier, sel.providerId as ProviderId, e.target.value)}
                      className="w-full px-3 py-2 text-[12px] rounded-lg bg-black/30 border border-white/10 focus:border-white/30 outline-none cursor-pointer text-white/85"
                    >
                      {provider.models.map((m) => (
                        <option key={m.id} value={m.id} className="bg-[#0a0612]">{m.label} · {m.contextK}k ctx</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <footer className="mt-10 pt-6 border-t border-white/[0.06] text-[10px] uppercase tracking-[0.22em] text-white/30">
          Keys are encrypted before storage and never logged. Revoking is reversible by re-pasting.
        </footer>
      </div>
    </div>
  )
}

function SectionTitle({ label, hint, compact }: { label: string; hint?: string; compact?: boolean }) {
  return (
    <div className={compact ? 'mb-0' : 'mb-4'}>
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/55 font-medium mb-1">{label}</div>
      {hint && <div className="text-[11px] text-white/40 max-w-xl leading-relaxed">{hint}</div>}
    </div>
  )
}

function StatusChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: 'primary' | 'quiet' | 'warn' }) {
  const style: React.CSSProperties = tone === 'primary'
    ? {
        background: 'color-mix(in oklab, var(--primary) 14%, transparent)',
        border: '1px solid color-mix(in oklab, var(--primary) 35%, transparent)',
        color: 'color-mix(in oklab, var(--primary) 25%, white)',
      }
    : tone === 'warn'
      ? {
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.32)',
          color: 'rgb(254,215,170)',
        }
      : {
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.55)',
        }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.18em] font-medium"
      style={style}
    >
      {icon}
      {label}
    </span>
  )
}

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

function ProviderCard({
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
          style={{
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
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
