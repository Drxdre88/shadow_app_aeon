'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Shield, Database, MessageSquare, AlertTriangle, Download, Sparkles, Check, Skull } from 'lucide-react'
import Image from 'next/image'
import { useThemeStore } from '@/stores/themeStore'
import { GlassStage } from '@/components/ui/GlassStage'
import { acceptBetaTerms } from '@/lib/actions/terms'
import aeonLogo from '@/assets/aeon.png'
import { BloodDrips, BloodFlood, BloodClots } from './GoreEffects'

const TERMS_SECTIONS = [
  {
    icon: AlertTriangle,
    title: 'Beta Software',
    color: '#f59e0b',
    content: 'Aeon is in active development. Features may change, break, or be removed. We will do our best to keep things stable, but bugs happen.',
  },
  {
    icon: Database,
    title: 'Your Data',
    color: '#3b82f6',
    content: 'Your data is stored securely on Neon Postgres. We do not sell or share your data with third parties. You can export all your data at any time from Settings.',
  },
  {
    icon: Download,
    title: 'Data Export',
    color: '#10b981',
    content: 'You always have the right to export your data. If we ever need to reset or wipe data, we will give advance notice and provide an export window.',
  },
  {
    icon: MessageSquare,
    title: 'Feedback',
    color: '#8b5cf6',
    content: 'By using the beta, you agree that feedback you provide (bug reports, feature requests, suggestions) may be used to improve Aeon.',
  },
  {
    icon: Shield,
    title: 'No Warranty',
    color: '#ef4444',
    content: 'Aeon is provided as-is during beta. We make no guarantees of uptime, data persistence, or feature availability. Use at your own discretion.',
  },
]

function GlowCheckbox({ checked, color }: { checked: boolean; color: string; onChange?: () => void }) {
  return (
    <div
      className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all duration-300 mt-0.5"
      style={{
        backgroundColor: checked ? `${color}25` : 'rgba(255,255,255,0.04)',
        border: `1.5px solid ${checked ? color : 'rgba(255,255,255,0.15)'}`,
        boxShadow: checked ? `0 0 8px ${color}40, 0 0 16px ${color}20` : 'none',
      }}
    >
      {checked && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        >
          <Check className="w-3 h-3" style={{ color }} strokeWidth={3} />
        </motion.div>
      )}
    </div>
  )
}

export default function BetaTermsContent() {
  const [accepting, setAccepting] = useState(false)
  const [checked, setChecked] = useState<boolean[]>(TERMS_SECTIONS.map(() => false))
  const [bloodMode, setBloodMode] = useState(false)
  const [bloodFloodKey, setBloodFloodKey] = useState(0)
  const prevAllChecked = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const allChecked = checked.every(Boolean)

  useEffect(() => {
    if (allChecked && !prevAllChecked.current && bloodMode) {
      setBloodFloodKey((k) => k + 1)
    }
    prevAllChecked.current = allChecked
  }, [allChecked, bloodMode])

  const toggleItem = (idx: number) => {
    setChecked((prev) => prev.map((v, i) => (i === idx ? !v : v)))
  }

  const toggleAll = () => {
    const next = !allChecked
    setChecked(TERMS_SECTIONS.map(() => next))
  }

  const handleAccept = async () => {
    setAccepting(true)
    try {
      await acceptBetaTerms()
      window.location.href = '/dashboard'
    } catch {
      setAccepting(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(15, 15, 25, 0.95) 0%, #0a0a0f 70%)',
      }}
    >
      <AnimatePresence>
        {bloodFloodKey > 0 && <BloodFlood key={bloodFloodKey} />}
      </AnimatePresence>

      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[20%] left-[20%]', size: 'w-[600px] h-[600px]', color: 'glow', opacity: 0.06 },
            { position: 'bottom-[20%] right-[20%]', size: 'w-[500px] h-[500px]', color: 'primary', opacity: 0.04, delay: 2 },
            { position: 'top-[50%] right-[40%]', size: 'w-[300px] h-[300px]', color: 'accent', opacity: 0.05, delay: 4 },
          ],
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-lg mx-4"
      >
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            backgroundColor: 'rgba(15, 15, 25, 0.9)',
            border: '1px solid var(--primary-muted)',
            boxShadow: [
              `0 0 ${40 * mult}px var(--glow-color)`,
              `0 0 ${80 * mult}px var(--glow-color)`,
              'inset 0 1px 0 rgba(255,255,255,0.05)',
            ].join(', '),
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="p-6 sm:p-8 pb-0">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="flex items-center justify-center gap-3 mb-2"
            >
              <Image
                src={aeonLogo}
                alt="Aeon"
                width={48}
                height={48}
                className="rounded-lg"
                style={{ filter: `drop-shadow(0 0 ${12 * mult}px var(--glow-color))` }}
              />
              <h1
                className="text-2xl sm:text-3xl font-bold"
                style={{
                  color: '#8a8f98',
                  textShadow: '0 0 15px rgba(138, 143, 152, 0.4), 0 0 30px rgba(138, 143, 152, 0.2)',
                }}
              >
                Aeon
              </h1>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center mb-6"
            >
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest mb-3"
                style={{
                  backgroundColor: 'rgba(139, 92, 246, 0.12)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  color: '#a78bfa',
                }}
              >
                <Sparkles className="w-3 h-3" />
                Closed Beta
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Before you dive in, here is what you should know.
              </p>
              <button
                onClick={() => setBloodMode((b) => !b)}
                className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider transition-all duration-300"
                style={{
                  backgroundColor: bloodMode ? 'rgba(60, 0, 0, 0.4)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${bloodMode ? 'rgba(120, 20, 20, 0.5)' : 'rgba(255,255,255,0.06)'}`,
                  color: bloodMode ? '#a44' : 'rgba(255,255,255,0.25)',
                  boxShadow: bloodMode ? '0 0 12px rgba(80, 0, 0, 0.3)' : 'none',
                }}
              >
                <Skull className="w-3 h-3" />
                {bloodMode ? 'Gore mode on' : 'Gore mode'}
              </button>
            </motion.div>
          </div>

          <div
            ref={scrollRef}
            className="px-6 sm:px-8 max-h-[400px] overflow-y-auto custom-scrollbar"
          >
            <div className="space-y-3 pb-4">
              {TERMS_SECTIONS.map((section, idx) => (
                <motion.div
                  key={section.title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + idx * 0.08, duration: 0.4 }}
                  className="flex gap-3 p-3 rounded-xl cursor-pointer transition-colors duration-200"
                  onClick={() => toggleItem(idx)}
                  style={{
                    backgroundColor: checked[idx] ? `${section.color}08` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${checked[idx] ? `${section.color}25` : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
                    style={{
                      backgroundColor: `${section.color}15`,
                      border: `1px solid ${section.color}30`,
                    }}
                  >
                    <section.icon className="w-4 h-4" style={{ color: section.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-white mb-0.5">{section.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                      {section.content}
                    </p>
                  </div>
                  <div className="relative">
                    <GlowCheckbox
                      checked={checked[idx]}
                      color={section.color}
                    />
                    {bloodMode && idx === 0 && checked[0] && !allChecked && <BloodClots />}
                    {bloodMode && idx === 4 && checked[4] && !allChecked && <BloodDrips />}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="p-6 sm:p-8 pt-4 space-y-3">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="space-y-3"
            >
              <button
                onClick={toggleAll}
                className="w-full py-2.5 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-2 hover:bg-white/[0.06]"
                style={{
                  backgroundColor: allChecked ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${allChecked ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255,255,255,0.08)'}`,
                  color: allChecked ? '#a78bfa' : 'var(--text-dim)',
                }}
              >
                <GlowCheckbox
                  checked={allChecked}
                  color="#a78bfa"
                />
                <span>{allChecked ? 'All terms acknowledged' : 'Acknowledge all terms'}</span>
              </button>

              <p
                className="text-xs text-center"
                style={{ color: 'var(--text-muted)', opacity: 0.7 }}
              >
                {allChecked
                  ? 'You have acknowledged all terms. Welcome aboard.'
                  : `${checked.filter(Boolean).length} of ${TERMS_SECTIONS.length} terms acknowledged`}
              </p>

              <button
                onClick={handleAccept}
                disabled={accepting || !allChecked}
                className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
                style={{
                  background: allChecked
                    ? 'linear-gradient(135deg, var(--primary), var(--accent))'
                    : 'rgba(255,255,255,0.06)',
                  color: allChecked ? '#fff' : 'var(--text-muted)',
                  boxShadow: allChecked ? `0 0 ${20 * mult}px var(--glow-color)` : 'none',
                  border: allChecked ? 'none' : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {accepting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Shield className="w-4 h-4" />
                )}
                <span>
                  {accepting
                    ? 'Accepting...'
                    : allChecked
                      ? 'Accept & Enter Aeon'
                      : 'Acknowledge all terms to continue'}
                </span>
              </button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
