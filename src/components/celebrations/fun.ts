import { registerCelebration } from './registry'
import type { CelebrationContext } from './types'

const CONFETTI_COLORS = ['#ff3b3b', '#3b8fff', '#3bff6b', '#ffe63b', '#ff3bce', '#ff8c3b', '#3bffff']
const BALLOON_COLORS = ['#ff85b3', '#85c8ff', '#85ffb8', '#d4a5ff', '#ffcf9e', '#fff685']
const FIREWORK_COLORS = ['#ff4d4d', '#ff9f4d', '#ffee4d', '#4dff6e', '#4dccff', '#a64dff', '#ff4dbb', '#ffffff']

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

registerCelebration({
  id: 'confetti-burst',
  name: 'Confetti Burst',
  category: 'fun',
  duration: 2500,
  render: (() => {
    interface ConfettiPiece {
      x: number
      y: number
      vx: number
      vy: number
      rotation: number
      rotationSpeed: number
      color: string
      shape: 'rect' | 'circle' | 'triangle'
      width: number
      height: number
      opacity: number
    }

    let pieces: ConfettiPiece[] | null = null

    return (c: CelebrationContext) => {
      if (!pieces) {
        pieces = Array.from({ length: 90 }, () => {
          const angle = Math.random() * Math.PI * 2
          const speed = 4 + Math.random() * 9
          const shapes: Array<'rect' | 'circle' | 'triangle'> = ['rect', 'circle', 'triangle']
          return {
            x: c.originX,
            y: c.originY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (3 + Math.random() * 4),
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            shape: shapes[Math.floor(Math.random() * 3)],
            width: 6 + Math.random() * 10,
            height: 4 + Math.random() * 8,
            opacity: 1,
          }
        })
      }

      const fadeStart = 0.8
      const globalAlpha = c.progress >= fadeStart
        ? 1 - (c.progress - fadeStart) / (1 - fadeStart)
        : 1

      for (const p of pieces) {
        p.vy += 0.15
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed

        c.ctx.save()
        c.ctx.globalAlpha = globalAlpha * p.opacity
        c.ctx.translate(p.x, p.y)
        c.ctx.rotate(p.rotation)
        c.ctx.fillStyle = p.color
        c.ctx.shadowColor = p.color
        c.ctx.shadowBlur = 4

        if (p.shape === 'rect') {
          c.ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height)
        } else if (p.shape === 'circle') {
          c.ctx.beginPath()
          c.ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2)
          c.ctx.fill()
        } else {
          c.ctx.beginPath()
          c.ctx.moveTo(0, -p.height)
          c.ctx.lineTo(p.width / 2, p.height / 2)
          c.ctx.lineTo(-p.width / 2, p.height / 2)
          c.ctx.closePath()
          c.ctx.fill()
        }

        c.ctx.restore()
      }

      if (c.progress >= 1) pieces = null
    }
  })(),
})

registerCelebration({
  id: 'fireworks',
  name: 'Fireworks',
  category: 'fun',
  duration: 2800,
  render: (() => {
    interface Spark {
      x: number
      y: number
      vx: number
      vy: number
      color: string
      alpha: number
      trail: Array<{ x: number; y: number; alpha: number }>
      trailLength: number
      mini: boolean
      miniTriggered: boolean
      miniProgress: number
    }

    interface Rocket {
      x: number
      startY: number
      targetY: number
      delay: number
      exploded: boolean
      explodeProgress: number
      sparks: Spark[]
      color: string
    }

    let rockets: Rocket[] | null = null

    return (c: CelebrationContext) => {
      if (!rockets) {
        rockets = [0, 300, 600, 900].map((delay, i) => ({
          x: c.originX + (i - 1.5) * 80 + (Math.random() - 0.5) * 60,
          startY: c.originY,
          targetY: c.height * (0.1 + Math.random() * 0.3),
          delay,
          exploded: false,
          explodeProgress: 0,
          sparks: [],
          color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
        }))
      }

      for (const rocket of rockets) {
        const rocketElapsed = c.elapsed - rocket.delay
        if (rocketElapsed < 0) continue

        const flightDuration = 600
        const flightProgress = Math.min(rocketElapsed / flightDuration, 1)
        const currentY = rocket.startY + (rocket.targetY - rocket.startY) * easeOutCubic(flightProgress)

        if (flightProgress < 1) {
          c.ctx.save()
          c.ctx.strokeStyle = rocket.color
          c.ctx.lineWidth = 2
          c.ctx.lineCap = 'round'
          c.ctx.shadowColor = rocket.color
          c.ctx.shadowBlur = 8
          c.ctx.globalAlpha = 0.9

          c.ctx.beginPath()
          c.ctx.moveTo(rocket.x, currentY)
          c.ctx.lineTo(rocket.x, currentY + 20)
          c.ctx.stroke()

          const grad = c.ctx.createRadialGradient(rocket.x, currentY, 0, rocket.x, currentY, 5)
          grad.addColorStop(0, '#ffffff')
          grad.addColorStop(0.4, rocket.color)
          grad.addColorStop(1, 'transparent')
          c.ctx.fillStyle = grad
          c.ctx.beginPath()
          c.ctx.arc(rocket.x, currentY, 5, 0, Math.PI * 2)
          c.ctx.fill()
          c.ctx.restore()
        }

        if (flightProgress >= 1 && !rocket.exploded) {
          rocket.exploded = true
          const sparkCount = 48
          rocket.sparks = Array.from({ length: sparkCount }, () => {
            const angle = (Math.PI * 2 * Math.random())
            const speed = 2 + Math.random() * 6
            const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]
            return {
              x: rocket.x,
              y: rocket.targetY,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              color,
              alpha: 1,
              trail: [],
              trailLength: 6 + Math.floor(Math.random() * 8),
              mini: Math.random() < 0.18,
              miniTriggered: false,
              miniProgress: 0,
            }
          })
        }

        if (rocket.exploded) {
          rocket.explodeProgress += 0.018

          for (const spark of rocket.sparks) {
            spark.trail.unshift({ x: spark.x, y: spark.y, alpha: spark.alpha })
            if (spark.trail.length > spark.trailLength) spark.trail.pop()

            spark.vy += 0.12
            spark.vx *= 0.985
            spark.vy *= 0.985
            spark.x += spark.vx
            spark.y += spark.vy
            spark.alpha = Math.max(0, spark.alpha - 0.012)

            if (spark.mini && !spark.miniTriggered && spark.alpha < 0.5) {
              spark.miniTriggered = true
            }

            for (let t = 0; t < spark.trail.length; t++) {
              const tp = spark.trail[t]
              const trailAlpha = tp.alpha * (1 - t / spark.trail.length) * 0.6
              c.ctx.save()
              c.ctx.globalAlpha = trailAlpha
              c.ctx.fillStyle = spark.color
              c.ctx.shadowColor = spark.color
              c.ctx.shadowBlur = 4
              c.ctx.beginPath()
              const r = (1 - t / spark.trail.length) * 2.5
              c.ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2)
              c.ctx.fill()
              c.ctx.restore()
            }

            c.ctx.save()
            c.ctx.globalAlpha = spark.alpha
            c.ctx.fillStyle = spark.color
            c.ctx.shadowColor = spark.color
            c.ctx.shadowBlur = 10
            c.ctx.beginPath()
            c.ctx.arc(spark.x, spark.y, 2.5, 0, Math.PI * 2)
            c.ctx.fill()
            c.ctx.restore()

            if (spark.miniTriggered && spark.alpha > 0.02) {
              const miniCount = 6
              for (let m = 0; m < miniCount; m++) {
                const ma = (Math.PI * 2 * m) / miniCount + spark.miniProgress * 0.3
                const mx = spark.x + Math.cos(ma) * 8
                const my = spark.y + Math.sin(ma) * 8
                c.ctx.save()
                c.ctx.globalAlpha = spark.alpha * 0.5
                c.ctx.fillStyle = '#ffffff'
                c.ctx.shadowColor = spark.color
                c.ctx.shadowBlur = 6
                c.ctx.beginPath()
                c.ctx.arc(mx, my, 1.2, 0, Math.PI * 2)
                c.ctx.fill()
                c.ctx.restore()
              }
              spark.miniProgress += 0.1
            }
          }
        }
      }

      if (c.progress >= 1) rockets = null
    }
  })(),
})

registerCelebration({
  id: 'balloon-rise',
  name: 'Balloon Rise',
  category: 'fun',
  duration: 3000,
  render: (() => {
    interface Balloon {
      x: number
      startY: number
      color: string
      speed: number
      sineFreq: number
      sineAmp: number
      sineOffset: number
      radiusX: number
      radiusY: number
      rotation: number
      rotationSpeed: number
      stringLength: number
      phase: number
    }

    let balloons: Balloon[] | null = null

    return (c: CelebrationContext) => {
      if (!balloons) {
        balloons = Array.from({ length: 13 }, (_, i) => ({
          x: c.originX + (i - 6) * 38 + (Math.random() - 0.5) * 30,
          startY: c.originY,
          color: BALLOON_COLORS[i % BALLOON_COLORS.length],
          speed: 0.9 + Math.random() * 0.7,
          sineFreq: 0.8 + Math.random() * 0.8,
          sineAmp: 18 + Math.random() * 22,
          sineOffset: Math.random() * Math.PI * 2,
          radiusX: 18 + Math.random() * 10,
          radiusY: 22 + Math.random() * 12,
          rotation: (Math.random() - 0.5) * 0.3,
          rotationSpeed: (Math.random() - 0.5) * 0.008,
          stringLength: 28 + Math.random() * 20,
          phase: Math.random() * Math.PI * 2,
        }))
      }

      const fadeStart = 0.82
      const globalAlpha = c.progress >= fadeStart
        ? 1 - (c.progress - fadeStart) / (1 - fadeStart)
        : 1

      for (const b of balloons) {
        const rise = c.elapsed * 0.001 * b.speed * c.height * 0.35
        const bx = b.x + Math.sin(c.elapsed * 0.001 * b.sineFreq + b.sineOffset) * b.sineAmp
        const by = b.startY - rise

        if (by + b.radiusY < -10) continue

        b.rotation += b.rotationSpeed

        c.ctx.save()
        c.ctx.globalAlpha = globalAlpha
        c.ctx.translate(bx, by)
        c.ctx.rotate(b.rotation)

        const grad = c.ctx.createRadialGradient(
          -b.radiusX * 0.3, -b.radiusY * 0.35, b.radiusX * 0.05,
          0, 0, b.radiusX * 1.2
        )
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.25, b.color)
        grad.addColorStop(1, shadeColor(b.color, -40))

        c.ctx.shadowColor = b.color
        c.ctx.shadowBlur = 14

        c.ctx.fillStyle = grad
        c.ctx.beginPath()
        c.ctx.ellipse(0, 0, b.radiusX, b.radiusY, 0, 0, Math.PI * 2)
        c.ctx.fill()

        c.ctx.fillStyle = 'rgba(255,255,255,0.55)'
        c.ctx.beginPath()
        c.ctx.ellipse(-b.radiusX * 0.3, -b.radiusY * 0.3, b.radiusX * 0.25, b.radiusY * 0.18, -0.5, 0, Math.PI * 2)
        c.ctx.fill()

        c.ctx.fillStyle = shadeColor(b.color, -30)
        c.ctx.shadowBlur = 0
        c.ctx.beginPath()
        c.ctx.moveTo(-4, b.radiusY - 1)
        c.ctx.lineTo(0, b.radiusY + 7)
        c.ctx.lineTo(4, b.radiusY - 1)
        c.ctx.closePath()
        c.ctx.fill()

        c.ctx.strokeStyle = 'rgba(180,180,180,0.6)'
        c.ctx.lineWidth = 1
        c.ctx.lineCap = 'round'
        c.ctx.shadowBlur = 0

        const cp1x = Math.sin(c.elapsed * 0.001 * b.sineFreq * 0.5 + b.phase) * 8
        c.ctx.beginPath()
        c.ctx.moveTo(0, b.radiusY + 7)
        c.ctx.quadraticCurveTo(cp1x, b.radiusY + b.stringLength * 0.5, 0, b.radiusY + b.stringLength)
        c.ctx.stroke()

        c.ctx.restore()
      }

      if (c.progress >= 1) balloons = null
    }
  })(),
})

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount))
  return `rgb(${r},${g},${b})`
}

registerCelebration({
  id: 'party-popper',
  name: 'Party Popper',
  category: 'fun',
  duration: 2200,
  render: (() => {
    interface StreamerPoint {
      x: number
      y: number
      vx: number
      vy: number
      phase: number
      freq: number
      amp: number
      age: number
    }

    interface Streamer {
      color: string
      points: StreamerPoint[]
      opacity: number
    }

    interface PopConfetti {
      x: number
      y: number
      vx: number
      vy: number
      color: string
      shape: 'rect' | 'circle'
      w: number
      h: number
      rotation: number
      rotationSpeed: number
    }

    interface PopperState {
      streamers: Streamer[]
      confetti: PopConfetti[]
      fired: boolean
    }

    let state: PopperState | null = null

    return (c: CelebrationContext) => {
      if (!state) {
        state = { streamers: [], confetti: [], fired: false }
      }

      const fireProgress = 0.1
      const popperSize = 36
      const coneX = c.originX
      const coneY = c.originY

      const recoilOffset = c.progress > fireProgress
        ? Math.sin((c.progress - fireProgress) * Math.PI * 4) * 3 * Math.exp(-(c.progress - fireProgress) * 8)
        : 0

      c.ctx.save()
      c.ctx.translate(coneX + recoilOffset, coneY)
      c.ctx.rotate(-Math.PI / 4)

      const coneGrad = c.ctx.createLinearGradient(-popperSize / 2, 0, popperSize / 2, 0)
      coneGrad.addColorStop(0, '#c0392b')
      coneGrad.addColorStop(0.5, '#e74c3c')
      coneGrad.addColorStop(1, '#922b21')

      c.ctx.fillStyle = coneGrad
      c.ctx.shadowColor = '#e74c3c'
      c.ctx.shadowBlur = 12
      c.ctx.beginPath()
      c.ctx.moveTo(-6, 0)
      c.ctx.lineTo(6, 0)
      c.ctx.lineTo(popperSize * 0.35, -popperSize)
      c.ctx.lineTo(-popperSize * 0.35, -popperSize)
      c.ctx.closePath()
      c.ctx.fill()

      c.ctx.strokeStyle = '#922b21'
      c.ctx.lineWidth = 1.5
      c.ctx.stroke()

      c.ctx.fillStyle = '#f39c12'
      c.ctx.shadowColor = '#f39c12'
      c.ctx.shadowBlur = 8
      c.ctx.beginPath()
      c.ctx.moveTo(-popperSize * 0.35, -popperSize)
      c.ctx.lineTo(popperSize * 0.35, -popperSize)
      c.ctx.lineTo(popperSize * 0.5, -popperSize * 1.1)
      c.ctx.lineTo(-popperSize * 0.5, -popperSize * 1.1)
      c.ctx.closePath()
      c.ctx.fill()

      c.ctx.restore()

      if (c.progress >= fireProgress && !state.fired) {
        state.fired = true

        for (let s = 0; s < 7; s++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3)
          const speed = 3.5 + Math.random() * 4
          const points: StreamerPoint[] = Array.from({ length: 14 }, (_, i) => ({
            x: coneX,
            y: coneY - popperSize,
            vx: Math.cos(angle) * speed * (1 - i * 0.04),
            vy: Math.sin(angle) * speed * (1 - i * 0.04) - i * 0.3,
            phase: Math.random() * Math.PI * 2,
            freq: 2 + Math.random() * 3,
            amp: 8 + Math.random() * 12,
            age: i * 2,
          }))
          state.streamers.push({
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            points,
            opacity: 1,
          })
        }

        for (let i = 0; i < 32; i++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3) + Math.PI / 4
          const speed = 2 + Math.random() * 7
          state.confetti.push({
            x: coneX,
            y: coneY - popperSize,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            shape: Math.random() < 0.5 ? 'rect' : 'circle',
            w: 5 + Math.random() * 8,
            h: 4 + Math.random() * 6,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.25,
          })
        }
      }

      const fadeStart = 0.78
      const fadeAlpha = c.progress >= fadeStart
        ? 1 - (c.progress - fadeStart) / (1 - fadeStart)
        : 1

      if (state.fired) {
        for (const streamer of state.streamers) {
          streamer.opacity = fadeAlpha

          for (const pt of streamer.points) {
            pt.vy += 0.08
            pt.vx *= 0.99
            pt.x += pt.vx
            pt.y += pt.vy
            pt.age++
          }

          c.ctx.save()
          c.ctx.globalAlpha = streamer.opacity
          c.ctx.strokeStyle = streamer.color
          c.ctx.lineWidth = 2.5
          c.ctx.lineCap = 'round'
          c.ctx.lineJoin = 'round'
          c.ctx.shadowColor = streamer.color
          c.ctx.shadowBlur = 6

          c.ctx.beginPath()
          for (let i = 0; i < streamer.points.length; i++) {
            const pt = streamer.points[i]
            const waveX = Math.sin(pt.age * 0.15 + pt.phase) * pt.amp * (i / streamer.points.length)
            const waveY = Math.cos(pt.age * 0.1 + pt.phase) * pt.amp * 0.4 * (i / streamer.points.length)
            const rx = pt.x + waveX
            const ry = pt.y + waveY
            if (i === 0) c.ctx.moveTo(rx, ry)
            else c.ctx.lineTo(rx, ry)
          }
          c.ctx.stroke()
          c.ctx.restore()
        }

        for (const p of state.confetti) {
          p.vy += 0.13
          p.vx *= 0.99
          p.x += p.vx
          p.y += p.vy
          p.rotation += p.rotationSpeed

          c.ctx.save()
          c.ctx.globalAlpha = fadeAlpha
          c.ctx.translate(p.x, p.y)
          c.ctx.rotate(p.rotation)
          c.ctx.fillStyle = p.color
          c.ctx.shadowColor = p.color
          c.ctx.shadowBlur = 5

          if (p.shape === 'rect') {
            c.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
          } else {
            c.ctx.beginPath()
            c.ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2)
            c.ctx.fill()
          }
          c.ctx.restore()
        }
      }

      if (c.progress >= 1) state = null
    }
  })(),
})

registerCelebration({
  id: 'star-explosion',
  name: 'Star Explosion',
  category: 'fun',
  duration: 2200,
  render: (() => {
    const STAR_COLORS = ['#FF0000', '#FF8800', '#FFFF00', '#00FF00', '#0088FF', '#8800FF', '#FF00FF']

    interface StarParticle {
      x: number
      y: number
      vx: number
      vy: number
      color: string
      rotation: number
      rotationSpeed: number
      size: number
      trail: Array<{ x: number; y: number }>
    }

    interface Sparkle {
      x: number
      y: number
      vx: number
      vy: number
      angle: number
      speed: number
      twinklePhase: number
      twinkleSpeed: number
      delay: number
    }

    interface State {
      stars: StarParticle[]
      sparkles: Sparkle[]
      initialized: boolean
    }

    let state: State | null = null

    function drawFourPointStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.beginPath()
      ctx.moveTo(0, -size)
      ctx.lineTo(size * 0.28, -size * 0.28)
      ctx.lineTo(size, 0)
      ctx.lineTo(size * 0.28, size * 0.28)
      ctx.lineTo(0, size)
      ctx.lineTo(-size * 0.28, size * 0.28)
      ctx.lineTo(-size, 0)
      ctx.lineTo(-size * 0.28, -size * 0.28)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    return (c: CelebrationContext) => {
      if (!state) {
        const stars: StarParticle[] = Array.from({ length: 65 }, (_, i) => {
          const angle = (Math.PI * 2 * i) / 65 + (Math.random() - 0.5) * 0.18
          const speedBase = 1.8 + Math.random() * 6.5
          return {
            x: c.originX,
            y: c.originY,
            vx: Math.cos(angle) * speedBase,
            vy: Math.sin(angle) * speedBase,
            color: STAR_COLORS[i % STAR_COLORS.length],
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.22,
            size: 3.5 + Math.random() * 4.5,
            trail: [],
          }
        })

        const sparkles: Sparkle[] = Array.from({ length: 35 }, (_, i) => {
          const angle = (Math.PI * 2 * i) / 35 + (Math.random() - 0.5) * 0.3
          const speed = 0.8 + Math.random() * 2.2
          return {
            x: c.originX,
            y: c.originY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            angle,
            speed,
            twinklePhase: Math.random() * Math.PI * 2,
            twinkleSpeed: 6 + Math.random() * 8,
            delay: 0.4 + Math.random() * 0.15,
          }
        })

        state = { stars, sparkles, initialized: true }
      }

      const maxDim = Math.sqrt(c.width * c.width + c.height * c.height)

      const fadeStart = 0.7
      const globalFade = c.progress >= fadeStart
        ? 1 - (c.progress - fadeStart) / (1 - fadeStart)
        : 1

      if (c.progress <= 0.15) {
        const pointProgress = c.progress / 0.15
        const pointSize = easeOutCubic(pointProgress) * 18

        c.ctx.save()
        c.ctx.globalAlpha = pointProgress
        c.ctx.fillStyle = '#ffffff'
        c.ctx.shadowColor = '#ffffff'
        c.ctx.shadowBlur = 40 * pointProgress

        c.ctx.beginPath()
        c.ctx.arc(c.originX, c.originY, pointSize, 0, Math.PI * 2)
        c.ctx.fill()
        c.ctx.restore()

        const streakAlpha = easeOutCubic(pointProgress)
        const streakLength = pointProgress * maxDim * 0.18
        const streakAngles = [0, Math.PI / 2, Math.PI / 4, (Math.PI * 3) / 4]

        for (const sa of streakAngles) {
          c.ctx.save()
          c.ctx.globalAlpha = streakAlpha * 0.7
          c.ctx.strokeStyle = '#ffffff'
          c.ctx.lineWidth = 2 * (1 - pointProgress * 0.5)
          c.ctx.lineCap = 'round'
          c.ctx.shadowColor = '#ffffff'
          c.ctx.shadowBlur = 12

          c.ctx.beginPath()
          c.ctx.moveTo(
            c.originX - Math.cos(sa) * streakLength,
            c.originY - Math.sin(sa) * streakLength
          )
          c.ctx.lineTo(
            c.originX + Math.cos(sa) * streakLength,
            c.originY + Math.sin(sa) * streakLength
          )
          c.ctx.stroke()
          c.ctx.restore()
        }
      }

      if (c.progress >= 0.15 && c.progress <= 0.7) {
        const ringProgress = (c.progress - 0.15) / 0.55
        const ringRadius = easeOutCubic(ringProgress) * maxDim * 0.75
        const ringAlpha = (1 - ringProgress) * globalFade

        const ringColorProgress = ringProgress
        const rR = Math.round(255 * (1 - ringColorProgress) + 255 * ringColorProgress)
        const rG = Math.round(255 * (1 - ringColorProgress * 0.85))
        const rB = 0
        const ringColor = `rgb(${rR},${rG},${rB})`

        c.ctx.save()
        c.ctx.globalAlpha = ringAlpha * 0.85
        c.ctx.strokeStyle = ringColor
        c.ctx.lineWidth = 6 * (1 - ringProgress * 0.7)
        c.ctx.shadowColor = ringColor
        c.ctx.shadowBlur = 24

        c.ctx.beginPath()
        c.ctx.arc(c.originX, c.originY, ringRadius, 0, Math.PI * 2)
        c.ctx.stroke()
        c.ctx.restore()
      }

      if (c.progress >= 0.15) {
        const starProgress = (c.progress - 0.15) / 0.85
        const slowFactor = c.progress >= 0.7 ? 1 - (c.progress - 0.7) / 0.3 * 0.6 : 1

        for (const star of state.stars) {
          star.trail.push({ x: star.x, y: star.y })
          if (star.trail.length > 4) star.trail.shift()

          star.x += star.vx * slowFactor
          star.y += star.vy * slowFactor
          star.rotation += star.rotationSpeed

          const starFade = c.progress >= 0.7
            ? 1 - (c.progress - 0.7) / 0.3
            : 1
          const currentSize = star.size * (c.progress >= 0.7 ? starFade * 0.8 + 0.2 : 1)

          for (let t = 0; t < star.trail.length; t++) {
            const tp = star.trail[t]
            const trailAlpha = ((t + 1) / star.trail.length) * 0.35 * starFade * globalFade

            c.ctx.save()
            c.ctx.globalAlpha = trailAlpha
            c.ctx.fillStyle = star.color
            c.ctx.shadowColor = star.color
            c.ctx.shadowBlur = 4
            drawFourPointStar(c.ctx, tp.x, tp.y, currentSize * (t + 1) / star.trail.length, star.rotation)
            c.ctx.restore()
          }

          c.ctx.save()
          c.ctx.globalAlpha = starFade * globalFade
          c.ctx.fillStyle = star.color
          c.ctx.shadowColor = star.color
          c.ctx.shadowBlur = 14
          drawFourPointStar(c.ctx, star.x, star.y, currentSize, star.rotation)
          c.ctx.restore()
        }
      }

      for (const sp of state.sparkles) {
        if (c.progress < sp.delay) continue

        const spProgress = (c.progress - sp.delay) / (1 - sp.delay)
        sp.x += sp.vx
        sp.y += sp.vy

        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(c.elapsed * 0.001 * sp.twinkleSpeed + sp.twinklePhase))
        const spFade = c.progress >= 0.7 ? 1 - (c.progress - 0.7) / 0.3 : 1
        const spAlpha = twinkle * spFade * globalFade

        c.ctx.save()
        c.ctx.globalAlpha = spAlpha
        c.ctx.fillStyle = '#FFD700'
        c.ctx.shadowColor = '#FFD700'
        c.ctx.shadowBlur = 10

        const spSize = (2.5 + Math.random() * 0.5) * twinkle
        c.ctx.beginPath()
        c.ctx.arc(sp.x, sp.y, spSize, 0, Math.PI * 2)
        c.ctx.fill()
        c.ctx.restore()
      }

      if (c.progress >= 1) state = null
    }
  })(),
})
