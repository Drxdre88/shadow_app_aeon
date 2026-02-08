'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sparkles, Calendar, LayoutGrid, Shield, Loader2 } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function LoginForm() {
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const error = searchParams.get('error')
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const handleGoogleSignIn = () => {
    setLoading(true)
    signIn('google', { callbackUrl })
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <motion.div
          className="absolute top-[20%] left-[25%] w-[600px] h-[600px] rounded-full blur-[120px]"
          style={{ background: 'var(--glow-color)', opacity: 0.15 }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.12, 0.22, 0.12] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-[20%] right-[20%] w-[500px] h-[500px] rounded-full blur-[100px]"
          style={{ background: 'var(--primary)', opacity: 0.1 }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.08, 0.18, 0.08] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <motion.div
          className="absolute top-[45%] left-[45%] w-[350px] h-[350px] rounded-full blur-[90px]"
          style={{ background: 'var(--accent)', opacity: 0.06 }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.06, 0.14, 0.06] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div
          className="relative p-8 rounded-2xl backdrop-blur-xl bg-gradient-to-b from-white/[0.08] to-black/40 border border-white/[0.08] overflow-hidden"
          style={{
            boxShadow: glowIntensity > 0
              ? `0 0 ${60 * mult}px ${15 * mult}px var(--glow-color), inset 0 1px 0 0 rgba(255,255,255,0.1)`
              : 'inset 0 1px 0 0 rgba(255,255,255,0.1)',
          }}
        >
          <div
            className="absolute top-0 left-8 right-8 h-[1.5px]"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
              boxShadow: `0 0 ${20 * mult}px ${4 * mult}px var(--glow-color)`,
            }}
          />
          <div
            className="absolute top-0 left-0 right-0 h-24 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, var(--primary-muted), transparent)' }}
          />

          <div className="relative text-center mb-8 pt-2">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-center gap-3 mb-3"
            >
              <div className="relative">
                <Sparkles className="w-9 h-9 text-[var(--primary)]" />
                <div
                  className="absolute inset-0 blur-lg opacity-60"
                  style={{ background: 'var(--glow-color)' }}
                />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-[var(--primary)] via-[var(--accent)] to-[var(--primary-hover)] bg-clip-text text-transparent">
                Aeon
              </h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-sm text-[var(--text-muted)]"
            >
              Beautiful project timelines
            </motion.p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
            >
              {error === 'OAuthAccountNotLinked'
                ? 'This email is already linked to another account'
                : 'Something went wrong. Please try again.'}
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl backdrop-blur-md bg-white/[0.07] border border-white/[0.12] text-[var(--text)] font-medium transition-all duration-300 hover:bg-white/[0.12] hover:border-white/[0.2] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                boxShadow: glowIntensity > 0
                  ? `0 0 ${15 * mult}px ${3 * mult}px var(--glow-color)`
                  : undefined,
              }}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[var(--primary)]" />
              ) : (
                <GoogleIcon />
              )}
              <span>{loading ? 'Redirecting...' : 'Continue with Google'}</span>
            </motion.button>
          </motion.div>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-[var(--text-dim)] uppercase tracking-wider">Powered by</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex items-center justify-center gap-8 text-[var(--text-dim)]"
          >
            <div className="flex items-center gap-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>Gantt</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <LayoutGrid className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Boards</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Shield className="w-3.5 h-3.5 text-[var(--success)]" />
              <span>Secure</span>
            </div>
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center text-xs text-[var(--text-dim)] mt-4"
        >
          By signing in you agree to the terms of service
        </motion.p>
      </motion.div>
    </div>
  )
}
