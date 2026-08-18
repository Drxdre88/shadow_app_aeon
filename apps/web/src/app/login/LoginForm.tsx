'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { useThemeStore } from '@/stores/themeStore'
import { GlassStage } from '@/components/ui/GlassStage'
import aeonLogo from '@/assets/aeon.png'
import chimaeraLogo from '@/assets/chimaera.png'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

export default function LoginForm() {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState('')
  const searchParams = useSearchParams()
  const rawCallback = searchParams.get('callbackUrl') || '/dashboard'
  const isSafePath = rawCallback === '/' || /^\/[a-zA-Z0-9]/.test(rawCallback)
  const callbackUrl = isSafePath ? rawCallback : '/dashboard'
  const error = searchParams.get('error')
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const handleOAuthSignIn = (provider: string) => {
    setLoadingProvider(provider)
    signIn(provider, { callbackUrl })
  }

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address')
      return
    }
    setEmailError('')
    setLoadingProvider('resend')
    try {
      const result = await signIn('resend', {
        email: trimmed,
        callbackUrl,
        redirect: false,
      })
      if (result?.error) {
        setEmailError(result.error === 'AccessDenied'
          ? 'Access is restricted. Contact the admin for an invite.'
          : 'Failed to send link. Try again.')
        setLoadingProvider(null)
      } else {
        setEmailSent(true)
        setLoadingProvider(null)
      }
    } catch {
      setEmailError('Failed to send link. Try again.')
      setLoadingProvider(null)
    }
  }

  const isLoading = loadingProvider !== null

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at center, rgba(15, 15, 25, 0.95) 0%, #0a0a0f 70%)`,
      }}
    >
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[30%] left-[30%]', size: 'w-[500px] h-[500px]', color: 'glow', opacity: 0.08 },
            { position: 'bottom-[25%] right-[25%]', size: 'w-[400px] h-[400px]', color: 'primary', opacity: 0.05, delay: 3 },
          ]
        }}
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="fixed top-5 right-6 z-20 flex items-center gap-2.5"
      >
        <Image
          src={chimaeraLogo}
          alt="Chimaera"
          width={32}
          height={32}
          className="rounded"
          style={{
            filter: `drop-shadow(0 0 8px rgba(13, 148, 136, 0.5))`,
          }}
        />
        <span
          className="text-base font-bold"
          style={{
            color: '#0d9488',
            textShadow: '0 0 10px rgba(13, 148, 136, 0.5), 0 0 20px rgba(13, 148, 136, 0.3)',
          }}
        >
          Chimaera Apps
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div
          className="relative p-6 sm:p-10 rounded-2xl overflow-hidden"
          style={{
            backgroundColor: 'rgba(15, 15, 25, 0.85)',
            border: `1px solid var(--primary-muted)`,
            boxShadow: [
              `0 0 ${40 * mult}px var(--glow-color)`,
              `0 0 ${80 * mult}px var(--glow-color)`,
              `inset 0 1px 0 rgba(255,255,255,0.05)`,
            ].join(', '),
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="text-center mb-6 sm:mb-10">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="flex items-center justify-center gap-3 sm:gap-4 mb-5"
            >
              <Image
                src={aeonLogo}
                alt="Aeon"
                width={64}
                height={64}
                className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg"
                style={{
                  filter: `drop-shadow(0 0 ${12 * mult}px var(--glow-color))`,
                }}
              />
              <h1
                className="text-3xl sm:text-4xl font-bold animate-pulse-glow"
                style={{
                  color: '#8a8f98',
                  textShadow: '0 0 15px rgba(138, 143, 152, 0.4), 0 0 30px rgba(138, 143, 152, 0.2), 0 2px 4px rgba(0,0,0,0.5)',
                  animationDuration: '4s',
                }}
              >
                Aeon
              </h1>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-4 flex flex-col items-center gap-3"
            >
              <div
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest"
                style={{
                  backgroundColor: 'rgba(139, 92, 246, 0.12)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  color: '#a78bfa',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: '#a78bfa' }}
                />
                Closed Beta
              </div>
              <p
                className="text-xs"
                style={{ color: 'var(--text-muted)', opacity: 0.7 }}
              >
                Invite-only access
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-4"
            >
              <p
                className="text-sm italic"
                style={{ color: 'var(--text-muted)' }}
              >
                &ldquo;Everything that has a beginning has an end.&rdquo;
              </p>
            </motion.div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4 px-4 py-3 rounded-xl text-sm text-center"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
              }}
            >
              {error === 'OAuthAccountNotLinked'
                ? 'This email is already linked to another account'
                : error === 'AccessDenied'
                  ? 'Access is restricted. Contact the admin for an invite.'
                  : 'Something went wrong. Please try again.'}
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {emailSent ? (
              <motion.div
                key="sent"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div
                  className="flex flex-col items-center gap-3 py-6 px-4 rounded-xl"
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.08)',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                  }}
                >
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  <p className="text-white font-medium text-center">Check your email</p>
                  <p className="text-sm text-slate-400 text-center">
                    We sent a sign-in link to <span className="text-white font-medium">{email}</span>
                  </p>
                </div>
                <button
                  onClick={() => { setEmailSent(false); setEmail('') }}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 hover:bg-white/[0.06]"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-dim)',
                  }}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to sign in
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: 0.6 }}
                className="space-y-3"
              >
                <button
                  onClick={() => handleOAuthSignIn('google')}
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
                  style={{
                    background: `linear-gradient(135deg, var(--primary), var(--accent))`,
                    color: '#fff',
                    boxShadow: `0 0 ${20 * mult}px var(--glow-color)`,
                  }}
                >
                  {loadingProvider === 'google' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>{loadingProvider === 'google' ? 'Redirecting...' : 'Continue with Google'}</span>
                </button>

                <button
                  onClick={() => handleOAuthSignIn('github')}
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#fff',
                  }}
                >
                  {loadingProvider === 'github' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <GitHubIcon />
                  )}
                  <span>{loadingProvider === 'github' ? 'Redirecting...' : 'Continue with GitHub'}</span>
                </button>

                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-slate-500 uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                <form onSubmit={handleEmailSignIn} className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setEmailError('') }}
                      placeholder="you@email.com"
                      disabled={isLoading}
                      className="w-full py-3.5 pl-10 pr-4 rounded-xl text-sm text-white placeholder-slate-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[color:var(--primary-muted)] disabled:opacity-50"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        border: emailError ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    />
                  </div>
                  {emailError && (
                    <p className="text-xs text-red-400 px-1">{emailError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--primary) 15%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
                      color: 'var(--primary-hover)',
                    }}
                  >
                    {loadingProvider === 'resend' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                    <span>{loadingProvider === 'resend' ? 'Sending...' : 'Send magic link'}</span>
                  </button>
                </form>

              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </motion.div>
    </div>
  )
}
