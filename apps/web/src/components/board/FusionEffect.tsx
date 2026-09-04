'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSmoothUiRenders, useThemeStore } from '@/stores/themeStore'
import { hexToRgba, resolveAccentHex } from '@/lib/utils/colors'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import type { FusionPlay } from './fusionMeasure'
import {
  IMPACT_MS,
  SETTLE_MS,
  arrivalTime,
  center,
  clamp01,
  easeOutCubic,
  ghostFrame,
  spawnBurst,
  stepParticles,
  totalDuration,
  type Particle,
  type Point,
} from './fusionEffectTiming'

// The fusion, made visible. Ghost cards (DOM, so they can carry the real
// title and accent) fly along arcs into the survivor while a canvas draws
// their light trails, and every arrival detonates a shockwave and a burst of
// that card's colour on the survivor, which finally breathes and settles.
// One requestAnimationFrame loop drives everything from fusionEffectTiming,
// so the ghosts and the canvas never disagree. The overlay is inert
// (pointer-events none) and portaled to <body>: it must sit outside the
// pinch-scaled columns wrapper, exactly like the drag overlay.
//
// Smooth UI Renders OFF kills every animation in Aeon; here that means no
// overlay at all — the store already shows the fused board.

interface FusionEffectProps {
  play: FusionPlay | null
  /** While several cards fuse: how many have landed on the server so far. */
  progress?: { done: number; total: number } | null
  onDone: (key: number) => void
}

const raf = (cb: FrameRequestCallback): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(Date.now()), 16) as unknown as number)
const caf = (handle: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle)
}

export function FusionEffect({ play, progress = null, onDone }: FusionEffectProps) {
  const mounted = useHasMounted()
  const smooth = useSmoothUiRenders()

  useEffect(() => {
    if (play && !smooth) onDone(play.key)
  }, [play, smooth, onDone])

  if (!mounted || !play || !smooth) return null
  return createPortal(<FusionScene key={play.key} play={play} progress={progress} onDone={onDone} />, document.body)
}

const TRAIL_LENGTH = 10
const BURST_PARTICLES = 42

function FusionScene({ play, progress, onDone }: { play: FusionPlay; progress: FusionEffectProps['progress']; onDone: (key: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ghostRefs = useRef<(HTMLDivElement | null)[]>([])
  const haloRef = useRef<HTMLDivElement>(null)
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const mult = glowIntensity / 75
  const count = play.sources.length
  const survivorHex = resolveAccentHex(play.survivor.color)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    const width = window.innerWidth
    const height = window.innerHeight
    if (canvas && ctx) {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)
    }

    const target = center(play.survivor.rect)
    const total = totalDuration(count)
    const lastArrival = arrivalTime(count - 1, count)
    const colors = play.sources.map((s) => resolveAccentHex(s.color))
    const trails: Point[][] = play.sources.map(() => [])
    const arrived: boolean[] = play.sources.map(() => false)
    const shocks: { at: number; color: string }[] = []
    let particles: Particle[] = []
    let start: number | null = null
    let last = 0
    let handle = 0
    let finished = false

    // No canvas shadowBlur anywhere: it is rasterised per stroke and turns a
    // 200-particle burst into a stall on software renderers. Glow is faked
    // with a wide faint pass under a thin bright one — same look, one blit.
    const draw = (t: number) => {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      trails.forEach((trail, i) => {
        if (trail.length < 2) return
        for (const pass of [{ width: 10, alpha: 0.18 * mult }, { width: 2.5, alpha: 0.85 }]) {
          for (let k = 1; k < trail.length; k++) {
            const f = k / trail.length
            ctx.strokeStyle = hexToRgba(colors[i], pass.alpha * f)
            ctx.lineWidth = pass.width * (0.3 + 0.7 * f)
            ctx.beginPath()
            ctx.moveTo(trail[k - 1].x, trail[k - 1].y)
            ctx.lineTo(trail[k].x, trail[k].y)
            ctx.stroke()
          }
        }
      })
      for (const shock of shocks) {
        const age = t - shock.at
        if (age < 0 || age > IMPACT_MS) continue
        const p = age / IMPACT_MS
        const radius = 18 + easeOutCubic(p) * 150
        const flash = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, radius * 0.7)
        flash.addColorStop(0, hexToRgba(shock.color, 0.42 * (1 - p)))
        flash.addColorStop(1, hexToRgba(shock.color, 0))
        ctx.fillStyle = flash
        ctx.beginPath()
        ctx.arc(target.x, target.y, radius * 0.7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = hexToRgba(shock.color, 0.9 * (1 - p))
        ctx.lineWidth = 0.5 + 3 * (1 - p)
        ctx.beginPath()
        ctx.arc(target.x, target.y, radius, 0, Math.PI * 2)
        ctx.stroke()
      }
      for (const p of particles) {
        const alpha = p.life / p.maxLife
        const radius = p.size * (0.4 + 0.6 * alpha)
        ctx.fillStyle = hexToRgba(p.color, alpha * 0.25 * mult)
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = hexToRgba(p.color, alpha)
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const frame = (now: number) => {
      if (start === null) { start = now; last = now }
      const t = now - start
      const dt = Math.min(48, now - last)
      last = now

      play.sources.forEach((source, i) => {
        const f = ghostFrame(source.rect, play.survivor.rect, i, count, t)
        const el = ghostRefs.current[i]
        if (el) {
          el.style.transform = `translate(${f.center.x - source.rect.width / 2}px, ${f.center.y - source.rect.height / 2}px) rotate(${f.rotate}deg) scale(${f.scale})`
          el.style.opacity = String(f.opacity)
          el.style.visibility = f.arrived ? 'hidden' : 'visible'
        }
        if (f.progress > 0 && !f.arrived) {
          const trail = trails[i]
          trail.push(f.center)
          if (trail.length > TRAIL_LENGTH) trail.shift()
        }
        if (f.arrived && !arrived[i]) {
          arrived[i] = true
          trails[i] = []
          particles = particles.concat(spawnBurst(target, colors[i], BURST_PARTICLES))
          shocks.push({ at: t, color: colors[i] })
        }
      })
      particles = stepParticles(particles, dt)
      draw(t)

      const halo = haloRef.current
      if (halo) {
        if (t >= lastArrival) {
          const settle = clamp01((t - lastArrival) / (IMPACT_MS + SETTLE_MS))
          const pulse = Math.sin(settle * Math.PI)
          halo.style.opacity = String(0.2 + 0.8 * pulse)
          halo.style.transform = `scale(${1 + 0.05 * pulse})`
        } else {
          const landed = arrived.filter(Boolean).length
          halo.style.opacity = String(0.15 + (0.45 * landed) / count)
        }
      }

      if (t >= total) {
        finished = true
        onDone(play.key)
        return
      }
      handle = raf(frame)
    }
    handle = raf(frame)
    return () => { if (!finished) caf(handle) }
  }, [play, count, mult, onDone])

  const survivorRect = play.survivor.rect

  return (
    <div aria-hidden data-fusion-effect className="fixed inset-0 z-[150] pointer-events-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {play.sources.map((source, i) => {
        const hex = resolveAccentHex(source.color)
        return (
          <div
            key={source.id}
            ref={(el) => { ghostRefs.current[i] = el }}
            data-fusion-ghost
            className="absolute left-0 top-0 rounded-xl border bg-slate-900/90 backdrop-blur px-3 py-2 will-change-transform overflow-hidden"
            style={{
              width: source.rect.width,
              height: source.rect.height,
              transform: `translate(${source.rect.x}px, ${source.rect.y}px)`,
              borderColor: hexToRgba(hex, 0.7),
              boxShadow: `0 0 ${24 * mult}px ${6 * mult}px ${hexToRgba(hex, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}
          >
            <div className="h-0.5 w-full rounded-full mb-2" style={{ backgroundColor: hex }} />
            <div className="text-sm font-medium text-white line-clamp-2">{source.name}</div>
          </div>
        )
      })}
      <div
        ref={haloRef}
        data-fusion-halo
        className="absolute rounded-xl"
        style={{
          left: survivorRect.x,
          top: survivorRect.y,
          width: survivorRect.width,
          height: survivorRect.height,
          opacity: 0.15,
          boxShadow: `0 0 0 2px ${hexToRgba(survivorHex, 0.9)}, 0 0 ${40 * mult}px ${12 * mult}px ${hexToRgba(survivorHex, 0.55)}`,
        }}
      />
      {progress && progress.total > 1 && (
        <div
          data-fusion-progress
          className="absolute -translate-x-1/2 -translate-y-full px-2 py-0.5 rounded-full text-[10px] font-semibold text-white border border-white/25 bg-slate-900/90 backdrop-blur"
          style={{ left: survivorRect.x + survivorRect.width / 2, top: survivorRect.y - 6, boxShadow: `0 0 ${12 * mult}px ${hexToRgba(survivorHex, 0.6)}` }}
        >
          Fusing {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </div>
      )}
    </div>
  )
}
