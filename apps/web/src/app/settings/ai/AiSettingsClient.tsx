'use client'

import { useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { PROVIDERS, type ProviderId, type AiTier } from '@/lib/ai/providers'
import { PROVIDER_TINT } from '@/lib/ai/providers-ui'
import {
  saveCredential,
  deleteCredential,
  testCandidateKey,
  savePreferences,
} from '@/lib/actions/ai-credentials'
import type { CredentialSummary, PreferenceShape } from '@/lib/data/ai-credentials'
import { ProviderCard, type TestResult } from './ProviderCard'
import { TierRoutingPanel } from './TierRoutingPanel'

type Props = {
  initialCredentials: CredentialSummary[]
  initialPreferences: PreferenceShape
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
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/55 font-medium mb-1">Provider keys</div>
            <div className="text-[11px] text-white/40 max-w-xl leading-relaxed">
              Paste a key, test it, save. We never see it again — it&apos;s encrypted before storage.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {PROVIDERS.map((p) => {
              const cred = credentialByProvider[p.id]
              const test = testResults[p.id]
              const busy = busyProvider === p.id
              const isActiveForBriefings = !!cred && heavyProvider === p.id
              return (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  tint={PROVIDER_TINT[p.id]}
                  cred={cred}
                  draft={drafts[p.id]}
                  revealed={reveal[p.id]}
                  test={test}
                  busy={busy}
                  isActiveForBriefings={isActiveForBriefings}
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

        <TierRoutingPanel
          preferences={preferences}
          credentialByProvider={credentialByProvider}
          pending={pending}
          savedFlash={savedFlash}
          onTierChange={updateTier}
          onSave={persistPreferences}
        />

        <footer className="mt-10 pt-6 border-t border-white/[0.06] text-[10px] uppercase tracking-[0.22em] text-white/30">
          Keys are encrypted before storage and never logged. Revoking is reversible by re-pasting.
        </footer>
      </div>
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
