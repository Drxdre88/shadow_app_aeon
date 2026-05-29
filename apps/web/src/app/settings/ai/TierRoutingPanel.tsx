'use client'

import { motion } from 'framer-motion'
import { Check, Loader2, Sparkles, Zap } from 'lucide-react'
import { PROVIDERS, type ProviderId, type AiTier } from '@/lib/ai/providers'
import { PROVIDER_TINT } from '@/lib/ai/providers-ui'
import type { CredentialSummary, PreferenceShape } from '@/lib/data/ai-credentials'

const TIER_INFO: Record<AiTier, { label: string; hint: string; icon: typeof Sparkles }> = {
  cheap:    { label: 'Cheap',    hint: 'Auto-tag, link suggestions, classification', icon: Sparkles },
  standard: { label: 'Standard', hint: 'Reflections, code, shell, summaries',         icon: Zap },
  heavy:    { label: 'Heavy',    hint: 'Briefings, advisories, deep work',            icon: Sparkles },
}

type TierRoutingPanelProps = {
  preferences: PreferenceShape
  credentialByProvider: Record<string, CredentialSummary>
  pending: boolean
  savedFlash: boolean
  onTierChange: (tier: AiTier, providerId: ProviderId, modelId: string) => void
  onSave: () => void
}

export function TierRoutingPanel({
  preferences, credentialByProvider, pending, savedFlash, onTierChange, onSave,
}: TierRoutingPanelProps) {
  return (
    <section>
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div className="mb-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-white/55 font-medium mb-1">Tier routing</div>
          <div className="text-[11px] text-white/40 max-w-xl leading-relaxed">
            Kairos picks a tier per task. Choose which provider and model serves each.
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onSave}
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
                    onTierChange(tier, nextProvider, firstModel)
                  }}
                  className="w-full px-3 py-2 text-[12px] rounded-lg bg-black/30 border border-white/10 focus:border-white/30 outline-none cursor-pointer"
                  style={{ color: tint }}
                >
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id} className="bg-[#0a0612]">{p.label}</option>)}
                </select>
                <select
                  value={sel.modelId}
                  onChange={(e) => onTierChange(tier, sel.providerId as ProviderId, e.target.value)}
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
  )
}
