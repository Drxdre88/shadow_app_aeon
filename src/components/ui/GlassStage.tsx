'use client'

import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

interface GlassStageBlobDef {
  position: string
  size: string
  color: 'glow' | 'primary' | 'accent'
  opacity: number
  delay?: number
}

interface GlassStageProps {
  enableGrid?: boolean
  blobConfig?: { blobs: GlassStageBlobDef[] }
}

const COLOR_VAR_MAP: Record<string, string> = {
  glow: 'var(--glow-color)',
  primary: 'var(--primary)',
  accent: 'var(--accent)',
}

const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' seed='2'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`

export function GlassStage({
  enableGrid = true,
  blobConfig,
}: GlassStageProps) {
  const { glowIntensity, glassOpacity, ambientBlobs } = useThemeStore()
  const mult = glowIntensity / 75
  const glass = glassOpacity / 50

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div
        className="absolute -top-[20%] -right-[10%] w-[70%] h-[60%] rounded-[40%]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--glow-color), transparent 70%)',
          opacity: 0.12 * mult * glass,
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute -bottom-[15%] -left-[10%] w-[60%] h-[50%] rounded-[40%]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--primary), transparent 70%)',
          opacity: 0.08 * mult * glass,
          filter: 'blur(100px)',
        }}
      />
      <div
        className="absolute top-[40%] left-[30%] w-[40%] h-[30%] rounded-[50%]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--accent), transparent 70%)',
          opacity: 0.05 * mult * glass,
          filter: 'blur(120px)',
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 3%, transparent 97%, rgba(255,255,255,0.03) 100%),
            radial-gradient(ellipse at 40% 20%, var(--glow-color) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, var(--primary) 0%, transparent 50%)
          `,
          opacity: 0.08 * mult * glass,
          mixBlendMode: 'screen' as const,
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage: GRAIN_SVG,
          backgroundRepeat: 'repeat',
          opacity: 0.4 * glass,
        }}
      />

      {enableGrid && (
        <div
          className="absolute inset-0 animate-glass-shimmer"
          style={{
            backgroundImage: `
              linear-gradient(var(--primary) 1px, transparent 1px),
              linear-gradient(90deg, var(--primary) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
            opacity: 0.03 * glass,
          }}
        />
      )}

      {ambientBlobs && blobConfig?.blobs.map((blob, idx) => (
        <div
          key={idx}
          className={cn(
            'absolute rounded-full animate-glow-breathe',
            blob.position,
            blob.size
          )}
          style={{
            background: COLOR_VAR_MAP[blob.color],
            opacity: blob.opacity * mult,
            filter: 'blur(120px)',
            animationDelay: blob.delay ? `${blob.delay}s` : undefined,
          }}
        />
      ))}

      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 50%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      <div
        className="absolute top-0 left-0 right-0 h-[1px]"
        style={{
          background: 'linear-gradient(90deg, transparent 5%, var(--glow-color) 30%, var(--primary) 50%, var(--glow-color) 70%, transparent 95%)',
          opacity: 0.25 * mult * glass,
        }}
      />

      <div
        className="absolute top-0 left-0 right-0 h-16"
        style={{
          background: `linear-gradient(180deg, rgba(255,255,255,${0.04 * glass}), transparent)`,
        }}
      />
    </div>
  )
}
