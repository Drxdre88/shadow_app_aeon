'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { KeyRound, Lock, Sparkles, ShieldCheck, ArrowRight, ChevronLeft } from 'lucide-react'
import AiSettingsClient from './AiSettingsClient'
import type { CredentialSummary, PreferenceShape } from '@/lib/data/ai-credentials'

// ─────────────────────────────────────────────────────────────────────────
// Stunning gated entry surface for /settings/ai.
//
// Lands every visitor on a cinematic hold-screen. Admins press through to
// the existing AI Settings registration workflow. Non-admins get a beta
// hold message instead of a 404 — the page no longer rugs them.
// ─────────────────────────────────────────────────────────────────────────

type Props = {
  isAdmin: boolean
  initialCredentials: CredentialSummary[] | null
  initialPreferences: PreferenceShape | null
}

const PROVIDER_BRANDS: Array<{ id: string; label: string; tint: string }> = [
  { id: 'anthropic', label: 'Anthropic', tint: '#c97e4a' },
  { id: 'openai',    label: 'OpenAI',    tint: '#10a37f' },
  { id: 'google',    label: 'Gemini',    tint: '#4f8df7' },
]

export default function BYOKEntryScreen({ isAdmin, initialCredentials, initialPreferences }: Props) {
  const [entered, setEntered] = useState(false)

  if (entered && isAdmin && initialCredentials && initialPreferences) {
    return (
      <div className="min-h-screen bg-[rgba(8,6,18,0.97)]">
        <div className="max-w-3xl mx-auto px-6 pt-6">
          <button
            onClick={() => setEntered(false)}
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-white/40 hover:text-white/80 transition-colors"
          >
            <ChevronLeft className="w-3 h-3" /> Back to overview
          </button>
        </div>
        <AiSettingsClient
          initialCredentials={initialCredentials}
          initialPreferences={initialPreferences}
        />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[rgba(6,4,16,1)] text-white">
      {/* radial backdrop glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 35%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 50% 80% at 50% 100%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 60%)',
        }}
      />
      {/* faint star dust */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.5), transparent), radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.35), transparent), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.45), transparent), radial-gradient(1px 1px at 85% 20%, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 10% 60%, rgba(255,255,255,0.4), transparent)',
          }}
        />
      </div>

      <div className="relative flex flex-col items-center justify-center min-h-screen px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="w-full max-w-lg"
        >
          {/* hero orb */}
          <div className="flex justify-center mb-10">
            <div className="relative">
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 40px color-mix(in oklab, var(--primary) 35%, transparent)',
                    '0 0 80px color-mix(in oklab, var(--primary) 55%, transparent)',
                    '0 0 40px color-mix(in oklab, var(--primary) 35%, transparent)',
                  ],
                }}
                transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                className="w-24 h-24 rounded-full flex items-center justify-center"
                style={{
                  background:
                    'radial-gradient(circle at 35% 35%, color-mix(in oklab, var(--primary) 75%, white) 0%, color-mix(in oklab, var(--primary) 40%, transparent) 50%, transparent 75%)',
                  border: '1px solid color-mix(in oklab, var(--primary) 45%, transparent)',
                }}
              >
                {isAdmin
                  ? <KeyRound className="w-8 h-8" style={{ color: 'color-mix(in oklab, var(--primary) 30%, white)' }} />
                  : <Lock className="w-8 h-8" style={{ color: 'color-mix(in oklab, var(--primary) 30%, white)' }} />
                }
              </motion.div>
              {/* satellite ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full"
                style={{
                  border: '1px dashed color-mix(in oklab, var(--primary) 25%, transparent)',
                  transform: 'scale(1.4)',
                }}
              />
            </div>
          </div>

          {/* status pill */}
          <div className="flex justify-center mb-6">
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.22em] font-medium"
              style={{
                background: 'color-mix(in oklab, var(--primary) 14%, transparent)',
                border: '1px solid color-mix(in oklab, var(--primary) 30%, transparent)',
                color: 'color-mix(in oklab, var(--primary) 30%, white)',
              }}
            >
              <Sparkles className="w-3 h-3" />
              {isAdmin ? 'Admin · private beta' : 'Private beta'}
            </div>
          </div>

          <h1 className="text-center text-3xl sm:text-4xl font-light tracking-tight mb-4">
            Bring your own AI
          </h1>

          <p className="text-center text-[14px] leading-relaxed text-white/55 mb-10 max-w-md mx-auto">
            Plug an Anthropic, OpenAI, or Gemini key into Aeon. Encrypted at rest with
            AES-256-GCM. Powers the morning briefer, advisory feed, and every AI-touched
            surface across Kairos.
          </p>

          {/* provider chips */}
          <div className="flex items-center justify-center gap-2.5 mb-10 flex-wrap">
            {PROVIDER_BRANDS.map((p) => (
              <div
                key={p.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] tracking-wide"
                style={{
                  background: `color-mix(in oklab, ${p.tint} 10%, rgba(255,255,255,0.02))`,
                  border: `1px solid color-mix(in oklab, ${p.tint} 28%, transparent)`,
                  color: `color-mix(in oklab, ${p.tint} 50%, white)`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: p.tint, boxShadow: `0 0 6px ${p.tint}` }}
                />
                {p.label}
              </div>
            ))}
          </div>

          {/* value pillars */}
          <div className="grid grid-cols-3 gap-3 mb-10">
            <Pillar
              icon={<ShieldCheck className="w-4 h-4" />}
              title="Encrypted"
              detail="AES-256-GCM at rest. Never logged."
            />
            <Pillar
              icon={<KeyRound className="w-4 h-4" />}
              title="Your account"
              detail="Your provider, your quota, your bill."
            />
            <Pillar
              icon={<Sparkles className="w-4 h-4" />}
              title="Per-tier"
              detail="Cheap / standard / heavy routed automatically."
            />
          </div>

          {/* CTA */}
          <div className="flex justify-center">
            {isAdmin ? (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setEntered(true)}
                className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[13px] font-medium transition-all duration-200"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in oklab, var(--primary) 55%, transparent), color-mix(in oklab, var(--primary) 25%, transparent))',
                  border: '1px solid color-mix(in oklab, var(--primary) 50%, transparent)',
                  boxShadow:
                    '0 0 24px color-mix(in oklab, var(--primary) 35%, transparent), inset 0 1px 0 rgba(255,255,255,0.12)',
                  color: 'color-mix(in oklab, var(--primary) 15%, white)',
                }}
              >
                Begin setup
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </motion.button>
            ) : (
              <GatedCallout />
            )}
          </div>

          <div className="mt-12 text-center text-[10px] uppercase tracking-[0.22em] text-white/25">
            Aeon · Kairos · Bring-your-own-key
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function Pillar({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div
      className="px-3 py-3 rounded-xl text-center"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="inline-flex w-7 h-7 items-center justify-center rounded-md mb-2"
        style={{
          background: 'color-mix(in oklab, var(--primary) 14%, transparent)',
          color: 'color-mix(in oklab, var(--primary) 25%, white)',
        }}
      >
        {icon}
      </div>
      <div className="text-[11px] font-medium text-white/80 mb-1">{title}</div>
      <div className="text-[10px] leading-snug text-white/40">{detail}</div>
    </div>
  )
}

function GatedCallout() {
  const [hover, setHover] = useState(false)
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[12px] font-medium cursor-not-allowed"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.55)',
        }}
      >
        <Lock className="w-3.5 h-3.5" />
        Rolling out soon
      </div>
      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-[11px] text-white/40 max-w-xs text-center leading-relaxed"
          >
            AI integration is admin-only during closed beta. You&apos;ll get a notice the moment your account unlocks.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
