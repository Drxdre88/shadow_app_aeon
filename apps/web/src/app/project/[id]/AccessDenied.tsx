'use client'

import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { GlassStage } from '@/components/ui/GlassStage'

interface AccessDeniedProps {
  projectName?: string | null
}

export function AccessDenied({ projectName }: AccessDeniedProps) {
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <GlassStage />
      <div
        className="relative z-10 max-w-md w-full mx-4 p-8 rounded-2xl text-center"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'color-mix(in srgb, var(--primary) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
          }}
        >
          <ShieldX className="w-8 h-8" style={{ color: 'var(--primary)' }} />
        </div>

        <h1 className="text-xl font-semibold text-white mb-2">Access Denied</h1>

        {projectName ? (
          <p className="text-sm text-white/50 mb-2">
            You don't have access to <span className="text-white/70 font-medium">{projectName}</span>
          </p>
        ) : (
          <p className="text-sm text-white/50 mb-2">This project doesn't exist or you don't have access</p>
        )}

        <p className="text-xs text-white/30 mb-8">
          Ask the project owner to invite you or add you to a realm containing this project
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{
            background: 'color-mix(in srgb, var(--primary) 20%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
            color: 'var(--primary)',
          }}
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
