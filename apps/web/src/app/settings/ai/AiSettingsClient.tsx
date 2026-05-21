'use client'

import { useState, useTransition } from 'react'
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

const TIER_LABEL: Record<AiTier, string> = {
  cheap: 'Cheap (auto-tag, link suggestions)',
  standard: 'Standard (briefings, PBI promotion)',
  heavy: 'Heavy (reserved for future deep work)',
}

export default function AiSettingsClient({ initialCredentials, initialPreferences }: Props) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>(initialCredentials)
  const [preferences, setPreferences] = useState<PreferenceShape>(initialPreferences)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({ anthropic: '', openai: '', google: '' })
  const [testResults, setTestResults] = useState<Record<ProviderId, TestResult | null>>({ anthropic: null, openai: null, google: null })
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const credentialByProvider = Object.fromEntries(credentials.map((c) => [c.provider, c])) as Record<string, CredentialSummary>

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
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500 mb-2">Brain · Phase C-0</div>
          <h1 className="text-2xl font-light tracking-tight">AI integration</h1>
          <p className="text-sm text-slate-400 mt-2 max-w-xl leading-relaxed">
            Bring your own provider keys. Encrypted at rest with AES-256-GCM. Admin-only — beta users do not see AI features yet.
          </p>
        </header>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-4">Provider keys</h2>
          <div className="space-y-3">
            {PROVIDERS.map((p) => {
              const cred = credentialByProvider[p.id]
              const test = testResults[p.id]
              const busy = busyProvider === p.id
              return (
                <div key={p.id} className="border border-white/5 rounded-xl bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {cred ? (
                          <>Connected · {cred.keyHint ?? '****'} · added {new Date(cred.createdAt).toLocaleDateString()}</>
                        ) : (
                          <>Not configured · <a className="underline hover:text-slate-300" href={p.docsUrl} target="_blank" rel="noreferrer">get a key</a></>
                        )}
                      </div>
                    </div>
                    {cred && (
                      <button
                        onClick={() => handleRevoke(cred.id, p.id)}
                        disabled={busy}
                        className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder={`Paste ${p.keyPrefix}... key`}
                      value={drafts[p.id]}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      className="flex-1 px-3 py-2 text-sm rounded-md bg-black/40 border border-white/10 focus:border-white/30 outline-none font-mono"
                    />
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={busy || drafts[p.id].length < 8}
                      className="px-3 py-2 text-xs rounded-md border border-white/10 hover:border-white/30 disabled:opacity-40"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleSave(p.id)}
                      disabled={busy || drafts[p.id].length < 8}
                      className="px-3 py-2 text-xs rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      {cred ? 'Replace' : 'Save'}
                    </button>
                  </div>

                  {test && (
                    <div className={`mt-3 text-[11px] ${test.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                      {test.ok
                        ? `OK · ${test.latencyMs}ms · reply: "${test.sample}"`
                        : `Failed · ${test.error}`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500">Default models per tier</h2>
            <button
              onClick={persistPreferences}
              disabled={pending}
              className="px-3 py-1.5 text-xs rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
            >
              {savedFlash ? 'Saved ✓' : pending ? 'Saving…' : 'Save preferences'}
            </button>
          </div>

          <div className="space-y-3">
            {(['cheap', 'standard', 'heavy'] as AiTier[]).map((tier) => {
              const sel = preferences[tier]
              const provider = PROVIDERS.find((p) => p.id === sel.providerId) ?? PROVIDERS[0]
              return (
                <div key={tier} className="border border-white/5 rounded-xl bg-white/[0.02] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500 mb-2">{tier}</div>
                  <div className="text-xs text-slate-400 mb-3">{TIER_LABEL[tier]}</div>
                  <div className="flex gap-2">
                    <select
                      value={sel.providerId}
                      onChange={(e) => {
                        const nextProvider = e.target.value as ProviderId
                        const firstModel = PROVIDERS.find((p) => p.id === nextProvider)?.models[0]?.id ?? sel.modelId
                        updateTier(tier, nextProvider, firstModel)
                      }}
                      className="px-3 py-2 text-xs rounded-md bg-black/40 border border-white/10 focus:border-white/30 outline-none"
                    >
                      {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <select
                      value={sel.modelId}
                      onChange={(e) => updateTier(tier, sel.providerId as ProviderId, e.target.value)}
                      className="flex-1 px-3 py-2 text-xs rounded-md bg-black/40 border border-white/10 focus:border-white/30 outline-none"
                    >
                      {provider.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.label} · {m.contextK}k ctx</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <footer className="mt-10 text-[11px] text-slate-600">
          Keys encrypted with AI_KEYS_MASTER_KEY · never logged · revoking is reversible by re-pasting.
        </footer>
      </div>
    </div>
  )
}
