'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
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
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-sm mx-4"
      >
        <div
          className="relative p-8 rounded-2xl overflow-hidden"
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
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mb-4"
            >
              <Image
                src={aeonLogo}
                alt="Aeon"
                width={80}
                height={80}
                className="mx-auto rounded-lg"
                style={{
                  filter: `drop-shadow(0 0 ${12 * mult}px var(--glow-color))`,
                }}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-center gap-2 mb-2"
            >
              <Image
                src={chimaeraLogo}
                alt="Chimaera"
                width={20}
                height={20}
                className="rounded-sm"
                style={{
                  filter: `drop-shadow(0 0 6px rgba(13, 148, 136, 0.5))`,
                }}
              />
              <span
                className="text-sm font-semibold"
                style={{
                  color: '#0d9488',
                  textShadow: '0 0 10px rgba(13, 148, 136, 0.5), 0 0 20px rgba(13, 148, 136, 0.3)',
                }}
              >
                Chimaera Apps
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-3xl font-bold"
              style={{
                color: '#8a8f98',
                textShadow: '0 0 15px rgba(138, 143, 152, 0.4), 0 0 30px rgba(138, 143, 152, 0.2), 0 2px 4px rgba(0,0,0,0.5)',
              }}
            >
              Aeon
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-xs text-[var(--text-dim)] mt-1 tracking-wider uppercase"
            >
              Project Timeline Management
            </motion.p>
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
                : 'Something went wrong. Please try again.'}
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="space-y-3"
          >
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
              style={{
                background: `linear-gradient(135deg, var(--primary), var(--accent))`,
                color: '#fff',
                boxShadow: `0 0 ${20 * mult}px var(--glow-color)`,
              }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              <span>{loading ? 'Redirecting...' : 'Sign in with Google'}</span>
            </button>

            <Link
              href="/demo"
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center hover:bg-white/[0.06]"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-dim)',
              }}
            >
              Try Demo
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-6 text-center text-xs"
            style={{ color: 'var(--text-dim)' }}
          >
            Secure session &middot; Google OAuth
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
