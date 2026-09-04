'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSmoothUiRenders, useThemeStore } from '@/stores/themeStore'
import { hexToRgba, resolveAccentHex } from '@/lib/utils/colors'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { measureCard, type FusionPlay } from './fusionMeasure'
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
/** Particle pool ceiling — a 50-card fusion must not become 2000 live arcs a frame. */
const MAX_PARTICLES = 1200

/** Particles per burst shrink with the swarm so the total stays bounded. */
export function burstSize(count: number): number {
  return Math.max(8, Math.round(BURST_PARTICLES / Math.sqrt(Math.max(1, count))))
}

function FusionScene({ play, progress, onDone }: { play: FusionPlay; progress: FusionEffectProps['progress']; onDone: (key: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ghostRefs = useRef<(HTMLDivElement | null)[]>([])
  const haloRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const mult = glowIntensity / 75
  const count = play.sources.length
  const survivorHex = resolveAccentHex(play.survivor.color)
  // Read by the loop through refs so a glow-slider nudge or a progress tick
  // never restarts the choreography.
  const multRef = useRef(mult)
  multRef.current = mult
  const progressRef = useRef(progress)
  progressRef.current = progress
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    let width = 0
    let height = 0
    // Sized on the first frame and again whenever the viewport changes (a
    // phone's URL bar collapsing mid-play is routine); assigning the backing
    // store resets the transform, so the scale is re-applied each time.
    const fit = () => {
      width = window.innerWidth
      height = window.innerHeight
      if (canvas && ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
      }
    }
    fit()

    const total = totalDuration(count)
    const lastArrival = arrivalTime(count - 1, count)
    const perBurst = burstSize(count)
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
    const draw = (t: number, target: Point) => {
      const mult = multRef.current
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
      // Clamped both ways: a long stall must not teleport particles, and the
      // timer fallback feeds Date.now(), which can step backwards.
      const dt = Math.max(0, Math.min(48, now - last))
      last = now
      if (window.innerWidth !== width || window.innerHeight !== height) fit()

      // The survivor MOVES while the play runs: the optimistic merge removes
      // the sources and the column reflows around it, and the board may
      // scroll. Every frame aims at where it is now, not where it was.
      const survivorRect = measureCard(play.survivor.id) ?? play.survivor.rect
      const target = center(survivorRect)

      play.sources.forEach((source, i) => {
        const f = ghostFrame(source.rect, survivorRect, i, count, t)
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
          particles = particles.concat(spawnBurst(target, colors[i], perBurst))
          if (particles.length > MAX_PARTICLES) particles = particles.slice(-MAX_PARTICLES)
          shocks.push({ at: t, color: colors[i] })
        }
      })
      particles = stepParticles(particles, dt)
      draw(t, target)

      const halo = haloRef.current
      if (halo) {
        halo.style.left = `${survivorRect.x}px`
        halo.style.top = `${survivorRect.y}px`
        halo.style.width = `${survivorRect.width}px`
        halo.style.height = `${survivorRect.height}px`
        if (t >= total) {
          // Holding for the server: a slow breath until the last step lands.
          const breath = 0.5 + 0.5 * Math.sin((t - total) / 320)
          halo.style.opacity = String(0.15 + 0.35 * breath)
          halo.style.transform = 'scale(1)'
        } else if (t >= lastArrival) {
          const settle = clamp01((t - lastArrival) / (IMPACT_MS + SETTLE_MS))
          const pulse = Math.sin(settle * Math.PI)
          halo.style.opacity = String(0.2 + 0.8 * pulse)
          halo.style.transform = `scale(${1 + 0.05 * pulse})`
        } else {
          const landed = arrived.filter(Boolean).length
          halo.style.opacity = String(count > 0 ? 0.15 + (0.45 * landed) / count : 0.15)
        }
      }
      const pill = pillRef.current
      if (pill) {
        pill.style.left = `${survivorRect.x + survivorRect.width / 2}px`
        pill.style.top = `${survivorRect.y - 6}px`
      }

      // Done when the choreography has played out AND the server has landed
      // every step — a long chain keeps the halo and the "k of N" pill up
      // rather than going dark for seconds before the toast.
      if (t >= total && !progressRef.current) {
        finished = true
        onDoneRef.current(play.key)
        return
      }
      handle = raf(frame)
    }
    handle = raf(frame)
    return () => { if (!finished) caf(handle) }
  }, [play, count])

  const survivorRect = play.survivor.rect

  return (
    // z-[90]: above the board, below the toast (z-100) that carries Undo —
    // particles must never paint over it — and below menus/dialogs (z-200).
    <div aria-hidden data-fusion-effect className="fixed inset-0 z-[90] pointer-events-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {play.sources.map((source, i) => {
        const hex = resolveAccentHex(source.color)
        return (
          <div
            key={source.id}
            ref={(el) => { ghostRefs.current[i] = el }}
            data-fusion-ghost
            className="absolute left-0 top-0 rounded-xl border bg-slate-900/95 px-3 py-2 will-change-transform overflow-hidden"
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
          ref={pillRef}
          data-fusion-progress
          className="absolute -translate-x-1/2 -translate-y-full px-2 py-0.5 rounded-full text-[10px] font-semibold text-white border border-white/25 bg-slate-900/95"
          style={{ left: survivorRect.x + survivorRect.width / 2, top: survivorRect.y - 6, boxShadow: `0 0 ${12 * mult}px ${hexToRgba(survivorHex, 0.6)}` }}
        >
          Fusing {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </div>
      )}
    </div>
  )
}
