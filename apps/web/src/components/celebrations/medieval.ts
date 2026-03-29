import { registerCelebration } from './registry'
import type { CelebrationContext } from './types'

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t * t
const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

interface TransmutationParticle {
  angle: number
  radius: number
  speed: number
  size: number
  color: string
  opacity: number
  inward: boolean
  vx: number
  vy: number
  x: number
  y: number
  life: number
}

interface TransmutationState {
  spiralParticles: TransmutationParticle[]
  dissolveParticles: TransmutationParticle[]
  initialized: boolean
}

registerCelebration({
  id: 'transmutation',
  name: 'Transmutation Circle',
  category: 'medieval',
  duration: 2400,
  render: (() => {
    let state: TransmutationState | null = null
    return (c: CelebrationContext) => {
      const { ctx, originX, originY, progress } = c
      if (!state) {
        const goldColors = ['#FFD700', '#DAA520', '#B8860B', '#FFF8DC', '#FFE55C']
        const spiralParticles: TransmutationParticle[] = []
        for (let i = 0; i < 32; i++) {
          const angle = (i / 32) * Math.PI * 2
          const radius = 80 + Math.random() * 10
          spiralParticles.push({
            angle,
            radius,
            speed: 0.8 + Math.random() * 0.6,
            size: 2 + Math.random() * 2.5,
            color: goldColors[i % goldColors.length],
            opacity: 1,
            inward: true,
            vx: 0, vy: 0,
            x: originX + Math.cos(angle) * radius,
            y: originY + Math.sin(angle) * radius,
            life: 1,
          })
        }
        const dissolveParticles: TransmutationParticle[] = []
        for (let i = 0; i < 28; i++) {
          const angle = Math.random() * Math.PI * 2
          dissolveParticles.push({
            angle,
            radius: 20 + Math.random() * 70,
            speed: 0.3 + Math.random() * 0.5,
            size: 1.5 + Math.random() * 3,
            color: goldColors[Math.floor(Math.random() * goldColors.length)],
            opacity: 1,
            inward: false,
            vx: (Math.random() - 0.5) * 1.2,
            vy: -(0.4 + Math.random() * 0.8),
            x: originX + Math.cos(angle) * (20 + Math.random() * 50),
            y: originY + Math.sin(angle) * (20 + Math.random() * 50),
            life: 1,
          })
        }
        state = { spiralParticles, dissolveParticles, initialized: true }
      }

      const outerRadius = 90
      const innerRadius = 68

      if (progress >= 1) { state = null; return }

      if (progress < 0.25) {
        const p = progress / 0.25

        ctx.save()
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 18
        ctx.strokeStyle = `rgba(255,215,0,${easeOut(p)})`
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeOut(p))
        ctx.stroke()
        ctx.restore()

        const innerP = Math.max(0, (p - 0.3) / 0.7)
        if (innerP > 0) {
          ctx.save()
          ctx.shadowColor = '#DAA520'
          ctx.shadowBlur = 10
          ctx.strokeStyle = `rgba(218,165,32,${innerP})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(originX, originY, innerRadius, 0, Math.PI * 2 * innerP)
          ctx.stroke()
          ctx.restore()
        }

        const hexP = Math.max(0, (p - 0.5) / 0.5)
        if (hexP > 0) {
          const triR = 52
          ctx.save()
          ctx.shadowColor = '#FFD700'
          ctx.shadowBlur = 8
          ctx.strokeStyle = `rgba(255,215,0,${hexP * 0.85})`
          ctx.lineWidth = 1.8
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 - Math.PI / 2
            const x = originX + Math.cos(a) * triR
            const y = originY + Math.sin(a) * triR
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.stroke()

          ctx.beginPath()
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + Math.PI / 2
            const x = originX + Math.cos(a) * triR
            const y = originY + Math.sin(a) * triR
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.stroke()
          ctx.restore()
        }

        const tickP = Math.max(0, (p - 0.6) / 0.4)
        if (tickP > 0) {
          const tickCount = 24
          ctx.save()
          ctx.strokeStyle = `rgba(255,215,0,${tickP * 0.7})`
          ctx.lineWidth = 1.5
          for (let i = 0; i < tickCount; i++) {
            const angle = (i / tickCount) * Math.PI * 2
            const isLong = i % 6 === 0
            const inner = outerRadius + 4
            const outer = inner + (isLong ? 10 : 6)
            ctx.beginPath()
            ctx.moveTo(originX + Math.cos(angle) * inner, originY + Math.sin(angle) * inner)
            ctx.lineTo(originX + Math.cos(angle) * outer, originY + Math.sin(angle) * outer)
            ctx.stroke()
          }
          ctx.restore()
        }
      }

      if (progress >= 0.25 && progress < 0.6) {
        const p = (progress - 0.25) / 0.35
        const glowIntensity = 0.6 + Math.sin(progress * 20) * 0.2

        ctx.save()
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 24 + Math.sin(progress * 18) * 8
        ctx.strokeStyle = `rgba(255,215,0,${glowIntensity})`
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius, 0, Math.PI * 2)
        ctx.stroke()

        ctx.strokeStyle = `rgba(218,165,32,${glowIntensity * 0.8})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(originX, originY, innerRadius, 0, Math.PI * 2)
        ctx.stroke()

        const triR = 52
        ctx.shadowBlur = 12
        ctx.strokeStyle = `rgba(255,215,0,0.8)`
        ctx.lineWidth = 1.8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 - Math.PI / 2
          if (i === 0) ctx.moveTo(originX + Math.cos(a) * triR, originY + Math.sin(a) * triR)
          else ctx.lineTo(originX + Math.cos(a) * triR, originY + Math.sin(a) * triR)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.beginPath()
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 2
          if (i === 0) ctx.moveTo(originX + Math.cos(a) * triR, originY + Math.sin(a) * triR)
          else ctx.lineTo(originX + Math.cos(a) * triR, originY + Math.sin(a) * triR)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.restore()

        for (const pt of state.spiralParticles) {
          const spiralSpeed = 2.5 + easeIn(p) * 4
          pt.radius = Math.max(0, pt.radius - spiralSpeed * 0.04)
          pt.angle += 0.06 + easeIn(p) * 0.08
          pt.x = originX + Math.cos(pt.angle) * pt.radius
          pt.y = originY + Math.sin(pt.angle) * pt.radius

          ctx.save()
          ctx.globalAlpha = (1 - pt.radius / 90) * 0.9
          ctx.shadowColor = pt.color
          ctx.shadowBlur = 10
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, pt.size * (1 + easeIn(p) * 0.5), 0, Math.PI * 2)
          ctx.fillStyle = pt.color
          ctx.fill()
          ctx.restore()
        }

        const tickCount = 24
        ctx.save()
        ctx.strokeStyle = `rgba(255,215,0,0.65)`
        ctx.lineWidth = 1.5
        for (let i = 0; i < tickCount; i++) {
          const angle = (i / tickCount) * Math.PI * 2
          const isLong = i % 6 === 0
          const inner = outerRadius + 4
          const outer = inner + (isLong ? 10 : 6)
          ctx.beginPath()
          ctx.moveTo(originX + Math.cos(angle) * inner, originY + Math.sin(angle) * inner)
          ctx.lineTo(originX + Math.cos(angle) * outer, originY + Math.sin(angle) * outer)
          ctx.stroke()
        }
        ctx.restore()
      }

      if (progress >= 0.6 && progress < 0.8) {
        const p = (progress - 0.6) / 0.2
        const flashOpacity = Math.sin(p * Math.PI) * 0.95

        ctx.save()
        const flashGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, outerRadius * 1.5)
        flashGrad.addColorStop(0, `rgba(255,255,220,${flashOpacity})`)
        flashGrad.addColorStop(0.3, `rgba(255,215,0,${flashOpacity * 0.8})`)
        flashGrad.addColorStop(0.65, `rgba(218,165,32,${flashOpacity * 0.4})`)
        flashGrad.addColorStop(1, 'rgba(184,134,11,0)')
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius * 1.5, 0, Math.PI * 2)
        ctx.fillStyle = flashGrad
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 40 + p * 20
        ctx.strokeStyle = `rgba(255,215,0,${0.9 - p * 0.4})`
        ctx.lineWidth = 2.5 + p
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      if (progress >= 0.8) {
        const p = (progress - 0.8) / 0.2
        for (const pt of state.dissolveParticles) {
          pt.x += pt.vx
          pt.y += pt.vy
          pt.vy -= 0.015
          pt.life = Math.max(0, 1 - p * 1.2)

          ctx.save()
          ctx.globalAlpha = pt.life * 0.9
          ctx.shadowColor = pt.color
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2)
          ctx.fillStyle = pt.color
          ctx.fill()
          ctx.restore()
        }

        const fadeOut = 1 - easeIn(p)
        ctx.save()
        ctx.globalAlpha = fadeOut
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 20
        ctx.strokeStyle = `rgba(255,215,0,${fadeOut * 0.6})`
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(originX, originY, outerRadius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  })()
})

interface SwordSpark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  color: string
}

interface SwordState {
  sparks: SwordSpark[]
  sparks2: SwordSpark[]
}

registerCelebration({
  id: 'sword-slash',
  name: 'Sword Slash',
  category: 'medieval',
  duration: 1400,
  render: (() => {
    let state: SwordState | null = null
    return (c: CelebrationContext) => {
      const { ctx, originX, originY, width, height, progress } = c
      if (!state) {
        const sparks: SwordSpark[] = []
        for (let i = 0; i < 36; i++) {
          const perpAngle = -Math.PI / 4 + Math.PI / 2 + (Math.random() - 0.5) * 1.2
          const speed = 3 + Math.random() * 5
          sparks.push({
            x: originX + (Math.random() - 0.5) * 60,
            y: originY + (Math.random() - 0.5) * 60,
            vx: Math.cos(perpAngle) * speed,
            vy: Math.sin(perpAngle) * speed - 1,
            life: 1,
            size: 1.5 + Math.random() * 2.5,
            color: Math.random() > 0.5 ? '#FFFFFF' : (Math.random() > 0.5 ? '#FFFF44' : '#FFA500'),
          })
        }
        const sparks2: SwordSpark[] = []
        for (let i = 0; i < 22; i++) {
          const perpAngle = (3 * Math.PI / 4) + Math.PI / 2 + (Math.random() - 0.5) * 1.0
          const speed = 2.5 + Math.random() * 4
          sparks2.push({
            x: originX + (Math.random() - 0.5) * 50,
            y: originY + (Math.random() - 0.5) * 50,
            vx: Math.cos(perpAngle) * speed,
            vy: Math.sin(perpAngle) * speed - 0.8,
            life: 1,
            size: 1.2 + Math.random() * 2,
            color: Math.random() > 0.5 ? '#E8E8E8' : '#87CEEB',
          })
        }
        state = { sparks, sparks2 }
      }

      if (progress >= 1) { state = null; return }

      const slashLen = 160
      const startX = originX + slashLen * 0.55
      const startY = originY - slashLen * 0.55
      const endX = originX - slashLen * 0.55
      const endY = originY + slashLen * 0.55

      if (progress < 0.15) {
        const p = easeOut(progress / 0.15)
        const cx = startX + (endX - startX) * p
        const cy = startY + (endY - startY) * p

        ctx.save()
        ctx.shadowColor = '#87CEEB'
        ctx.shadowBlur = 22
        const bladeGrad = ctx.createLinearGradient(startX, startY, endX, endY)
        bladeGrad.addColorStop(0, 'rgba(255,255,255,0)')
        bladeGrad.addColorStop(0.3, 'rgba(240,240,255,0.9)')
        bladeGrad.addColorStop(0.7, 'rgba(200,220,255,0.95)')
        bladeGrad.addColorStop(1, 'rgba(255,255,255,0)')

        const perpX = -(endY - startY) / slashLen
        const perpY = (endX - startX) / slashLen
        const halfW = 4

        ctx.beginPath()
        ctx.moveTo(startX + perpX * halfW * 0.1, startY + perpY * halfW * 0.1)
        ctx.lineTo(cx + perpX * halfW, cy + perpY * halfW)
        ctx.lineTo(cx - perpX * halfW, cy - perpY * halfW)
        ctx.lineTo(startX - perpX * halfW * 0.1, startY - perpY * halfW * 0.1)
        ctx.closePath()
        ctx.fillStyle = bladeGrad
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.shadowColor = '#FFFFFF'
        ctx.shadowBlur = 14
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(cx, cy)
        ctx.stroke()
        ctx.restore()
      }

      if (progress >= 0.15 && progress < 0.4) {
        const impactP = (progress - 0.15) / 0.25
        for (const spark of state.sparks) {
          spark.x += spark.vx
          spark.y += spark.vy
          spark.vy += 0.18
          spark.life = Math.max(0, 1 - impactP * 1.3)

          if (spark.life <= 0) continue
          ctx.save()
          ctx.globalAlpha = spark.life

          ctx.shadowColor = spark.color
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.moveTo(spark.x, spark.y)
          ctx.lineTo(spark.x - spark.vx * 3, spark.y - spark.vy * 3)
          ctx.strokeStyle = spark.color
          ctx.lineWidth = spark.size * 0.7
          ctx.lineCap = 'round'
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(spark.x, spark.y, spark.size * 0.5, 0, Math.PI * 2)
          ctx.fillStyle = spark.color
          ctx.fill()
          ctx.restore()
        }
      }

      if (progress >= 0.2 && progress < 0.4) {
        const p2 = easeOut((progress - 0.2) / 0.15)
        const slashLen2 = 120
        const s2x = originX - slashLen2 * 0.5
        const s2y = originY - slashLen2 * 0.5
        const e2x = originX + slashLen2 * 0.5
        const e2y = originY + slashLen2 * 0.5
        const c2x = s2x + (e2x - s2x) * p2
        const c2y = s2y + (e2y - s2y) * p2
        const fadeP2 = progress > 0.3 ? 1 - (progress - 0.3) / 0.1 : 1

        ctx.save()
        ctx.globalAlpha = fadeP2 * 0.7
        ctx.shadowColor = '#87CEEB'
        ctx.shadowBlur = 14
        ctx.strokeStyle = 'rgba(180,210,255,0.85)'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(s2x, s2y)
        ctx.lineTo(c2x, c2y)
        ctx.stroke()
        ctx.restore()

        if (progress >= 0.25) {
          const sp2P = (progress - 0.25) / 0.15
          for (const spark of state.sparks2) {
            spark.x += spark.vx * 0.5
            spark.y += spark.vy * 0.5
            spark.vy += 0.12
            spark.life = Math.max(0, 1 - sp2P * 1.5)
            if (spark.life <= 0) continue
            ctx.save()
            ctx.globalAlpha = spark.life * 0.7
            ctx.shadowColor = '#87CEEB'
            ctx.shadowBlur = 6
            ctx.beginPath()
            ctx.arc(spark.x, spark.y, spark.size * 0.4, 0, Math.PI * 2)
            ctx.fillStyle = spark.color
            ctx.fill()
            ctx.restore()
          }
        }
      }

      if (progress >= 0.15) {
        const afterglowP = Math.min((progress - 0.15) / 0.85, 1)
        const afterglowOpacity = (1 - easeOut(afterglowP)) * 0.75

        if (afterglowOpacity > 0) {
          ctx.save()
          ctx.globalAlpha = afterglowOpacity
          ctx.shadowColor = '#87CEEB'
          ctx.shadowBlur = 18 * (1 - afterglowP)
          ctx.strokeStyle = `rgba(180,210,255,${afterglowOpacity})`
          ctx.lineWidth = 1.5
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(startX, startY)
          ctx.lineTo(endX, endY)
          ctx.stroke()
          ctx.restore()
        }
      }

      if (progress >= 0.4) {
        const fallP = (progress - 0.4) / 0.6
        for (const spark of state.sparks) {
          spark.vy += 0.08
          spark.life = Math.max(0, spark.life - 0.008)
          if (spark.life <= 0) continue
          ctx.save()
          ctx.globalAlpha = spark.life * 0.5
          ctx.beginPath()
          ctx.arc(spark.x, spark.y, spark.size * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = '#FFA500'
          ctx.fill()
          ctx.restore()
        }
      }
    }
  })()
})

interface FireParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  phase: number
}

interface DragonFireState {
  particles: FireParticle[]
  embers: FireParticle[]
  lastEmit: number
}

registerCelebration({
  id: 'dragon-fire',
  name: 'Dragon Fire',
  category: 'medieval',
  duration: 2200,
  render: (() => {
    let state: DragonFireState | null = null
    return (c: CelebrationContext) => {
      const { ctx, originX, originY, width, height, progress, elapsed } = c
      if (!state) {
        state = { particles: [], embers: [], lastEmit: 0 }
      }

      if (progress >= 1) { state = null; return }

      const emitOriginX = originX - 80
      const emitOriginY = originY + 10

      if (progress < 0.7 && elapsed - state.lastEmit > 18) {
        state.lastEmit = elapsed
        const count = progress < 0.2 ? 3 : (progress < 0.5 ? 6 : 4)
        for (let i = 0; i < count; i++) {
          const spread = (Math.random() - 0.5) * 0.5
          const speed = 3.5 + Math.random() * 2.5
          const angle = spread
          const maxLife = 800 + Math.random() * 600
          state.particles.push({
            x: emitOriginX + (Math.random() - 0.5) * 18,
            y: emitOriginY + (Math.random() - 0.5) * 14,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.5 - Math.random() * 0.5,
            life: maxLife,
            maxLife,
            size: 5 + Math.random() * 10,
            phase: Math.random() * Math.PI * 2,
          })
        }
      }

      if (progress >= 0.7) {
        const emberCount = progress < 0.75 ? 3 : 1
        if (elapsed - state.lastEmit > 35) {
          state.lastEmit = elapsed
          for (let i = 0; i < emberCount; i++) {
            state.embers.push({
              x: emitOriginX + (Math.random() - 0.5) * 60,
              y: emitOriginY + (Math.random() - 0.5) * 20,
              vx: (Math.random() - 0.5) * 1.2,
              vy: -(0.5 + Math.random() * 1.2),
              life: 600 + Math.random() * 400,
              maxLife: 1000,
              size: 2 + Math.random() * 3,
              phase: Math.random() * Math.PI * 2,
            })
          }
        }
      }

      const dt = 16

      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i]
        p.life -= dt
        if (p.life <= 0) { state.particles.splice(i, 1); continue }

        p.x += p.vx
        p.y += p.vy
        p.vy -= 0.04
        p.x += Math.sin(elapsed * 0.008 + p.phase) * 0.5

        const lifeFrac = p.life / p.maxLife
        const sizeNow = p.size * Math.sin(lifeFrac * Math.PI) * 1.1

        let r: number, g: number, b: number
        if (lifeFrac > 0.75) {
          const t = (lifeFrac - 0.75) / 0.25
          r = 255; g = Math.round(255 * t); b = Math.round(255 * t)
        } else if (lifeFrac > 0.5) {
          const t = (lifeFrac - 0.5) / 0.25
          r = 255; g = Math.round(200 * t); b = 0
        } else if (lifeFrac > 0.25) {
          const t = (lifeFrac - 0.25) / 0.25
          r = 255; g = Math.round(69 + 131 * (1 - t)); b = 0
        } else {
          const t = lifeFrac / 0.25
          r = Math.round(139 * t); g = 0; b = 0
        }

        const alpha = Math.min(lifeFrac * 4, 1) * 0.9

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.shadowColor = `rgb(${r},${Math.round(g * 0.5)},0)`
        ctx.shadowBlur = sizeNow * 1.5

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sizeNow)
        grad.addColorStop(0, `rgba(255,255,${Math.round(200 * (lifeFrac > 0.7 ? 1 : 0))},${alpha})`)
        grad.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.85})`)
        grad.addColorStop(1, `rgba(${Math.round(r * 0.3)},0,0,0)`)
        ctx.beginPath()
        ctx.arc(p.x, p.y, sizeNow, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.restore()
      }

      if (progress > 0.15 && progress < 0.7) {
        const shimmerY = originY - 5
        const shimmerCount = 6
        ctx.save()
        ctx.globalAlpha = 0.06
        ctx.strokeStyle = '#FFA500'
        ctx.lineWidth = 2
        for (let i = 0; i < shimmerCount; i++) {
          const y = shimmerY - i * 6
          ctx.beginPath()
          ctx.moveTo(emitOriginX, y)
          for (let x = emitOriginX; x < originX + 160; x += 8) {
            ctx.lineTo(x, y + Math.sin(x * 0.08 + elapsed * 0.01 + i) * 3)
          }
          ctx.stroke()
        }
        ctx.restore()
      }

      for (let i = state.embers.length - 1; i >= 0; i--) {
        const e = state.embers[i]
        e.life -= dt
        if (e.life <= 0) { state.embers.splice(i, 1); continue }
        e.x += e.vx + Math.sin(elapsed * 0.007 + e.phase) * 0.3
        e.y += e.vy
        e.vy += 0.015

        const lifeFrac = e.life / e.maxLife
        ctx.save()
        ctx.globalAlpha = lifeFrac * 0.85
        ctx.shadowColor = '#FF4500'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.size * lifeFrac, 0, Math.PI * 2)
        ctx.fillStyle = '#FF6600'
        ctx.fill()
        ctx.restore()
      }
    }
  })()
})

interface Bubble {
  x: number
  y: number
  radius: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  popping: boolean
  popProgress: number
}

interface SteamParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
}

interface Sparkle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  size: number
}

interface PotionState {
  bubbles: Bubble[]
  steam: SteamParticle[]
  sparkles: Sparkle[]
  vortexAngle: number
  lastEmit: number
  lastSteam: number
}

registerCelebration({
  id: 'potion-complete',
  name: 'Potion Complete',
  category: 'medieval',
  duration: 2600,
  render: (() => {
    let state: PotionState | null = null
    return (c: CelebrationContext) => {
      const { ctx, originX, originY, progress, elapsed } = c
      if (!state) {
        state = {
          bubbles: [],
          steam: [],
          sparkles: [],
          vortexAngle: 0,
          lastEmit: 0,
          lastSteam: 0,
        }
      }

      if (progress >= 1) { state = null; return }

      const surfaceY = originY + 20
      const surfaceW = 90
      const bubbleColors = ['#00ff66', '#33ff88', '#9D00FF', '#BB44FF', '#FFD700', '#FFEA44']
      const dt = 16

      const emitRate = progress < 0.3 ? 120 : (progress < 0.7 ? 55 : 25)
      if (progress < 0.9 && elapsed - state.lastEmit > emitRate) {
        state.lastEmit = elapsed
        const count = progress < 0.3 ? 1 : (progress < 0.7 ? 2 : 1)
        for (let i = 0; i < count; i++) {
          const radius = 3 + Math.random() * (progress < 0.5 ? 7 : 9)
          const maxLife = 600 + Math.random() * 600
          state.bubbles.push({
            x: originX + (Math.random() - 0.5) * surfaceW,
            y: surfaceY,
            radius,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -(0.5 + Math.random() * 0.8) * (progress < 0.3 ? 0.7 : 1.2),
            life: maxLife,
            maxLife,
            color: bubbleColors[Math.floor(Math.random() * bubbleColors.length)],
            popping: false,
            popProgress: 0,
          })
        }
      }

      if (progress < 0.7 && elapsed - state.lastSteam > 80) {
        state.lastSteam = elapsed
        state.steam.push({
          x: originX + (Math.random() - 0.5) * 40,
          y: surfaceY - 10,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.4 + Math.random() * 0.6),
          life: 1,
          size: 6 + Math.random() * 12,
        })
      }

      if (progress >= 0.9) {
        const sparkleRate = 60
        if (elapsed - state.lastEmit > sparkleRate) {
          state.lastEmit = elapsed
          for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2
            state.sparkles.push({
              x: originX + (Math.random() - 0.5) * surfaceW,
              y: surfaceY + (Math.random() - 0.5) * 20,
              vx: Math.cos(angle) * (0.5 + Math.random()),
              vy: Math.sin(angle) * (0.5 + Math.random()) - 1,
              life: 1,
              color: bubbleColors[Math.floor(Math.random() * bubbleColors.length)],
              size: 2 + Math.random() * 3,
            })
          }
        }
      }

      state.vortexAngle += 0.04 * (progress < 0.3 ? 0.5 : 1)

      const waveAmplitude = progress < 0.3 ? 3 : (progress < 0.7 ? 5 : 3)
      const waveFreq = 0.06
      const waveOffset = elapsed * 0.003

      ctx.save()
      ctx.shadowColor = '#00ff66'
      ctx.shadowBlur = 10
      ctx.strokeStyle = progress < 0.3 ? 'rgba(0,255,102,0.6)' : 'rgba(157,0,255,0.7)'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(originX - surfaceW, surfaceY + Math.sin((originX - surfaceW) * waveFreq + waveOffset) * waveAmplitude)
      for (let x = originX - surfaceW; x <= originX + surfaceW; x += 2) {
        ctx.lineTo(x, surfaceY + Math.sin(x * waveFreq + waveOffset) * waveAmplitude)
      }
      ctx.stroke()
      ctx.restore()

      if (progress >= 0.3 && progress < 0.9) {
        const vortexR = surfaceW * 0.7
        ctx.save()
        const spiralCount = 3
        for (let s = 0; s < spiralCount; s++) {
          const sAngle = state.vortexAngle + (s / spiralCount) * Math.PI * 2
          ctx.globalAlpha = 0.12
          ctx.strokeStyle = s === 0 ? '#00ff66' : (s === 1 ? '#9D00FF' : '#FFD700')
          ctx.lineWidth = 3
          ctx.beginPath()
          for (let t = 0; t < 1; t += 0.05) {
            const r = vortexR * t
            const a = sAngle + t * Math.PI * 4
            const px = originX + Math.cos(a) * r
            const py = surfaceY + Math.sin(a) * r * 0.25
            if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
          }
          ctx.stroke()
        }
        ctx.restore()
      }

      for (let i = state.bubbles.length - 1; i >= 0; i--) {
        const b = state.bubbles[i]
        b.life -= dt
        b.x += b.vx + Math.sin(elapsed * 0.006 + i) * 0.3
        b.y += b.vy

        if (b.y < surfaceY - 80 || b.life <= 0) {
          b.popping = true
        }

        if (b.popping) {
          b.popProgress += 0.12
          if (b.popProgress >= 1) { state.bubbles.splice(i, 1); continue }

          ctx.save()
          ctx.globalAlpha = (1 - b.popProgress) * 0.8
          ctx.shadowColor = b.color
          ctx.shadowBlur = 10
          ctx.strokeStyle = b.color
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(b.x, b.y, b.radius * (1 + b.popProgress * 0.5), 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
          continue
        }

        const lifeFrac = b.life / b.maxLife
        ctx.save()
        ctx.globalAlpha = Math.min(lifeFrac * 3, 1) * 0.85
        ctx.shadowColor = b.color
        ctx.shadowBlur = 12

        const bubbleGrad = ctx.createRadialGradient(b.x - b.radius * 0.35, b.y - b.radius * 0.35, 0, b.x, b.y, b.radius)
        bubbleGrad.addColorStop(0, `rgba(255,255,255,0.7)`)
        bubbleGrad.addColorStop(0.3, `${b.color}99`)
        bubbleGrad.addColorStop(1, `${b.color}44`)
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2)
        ctx.fillStyle = bubbleGrad
        ctx.fill()
        ctx.strokeStyle = b.color
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }

      for (let i = state.steam.length - 1; i >= 0; i--) {
        const s = state.steam[i]
        s.life -= 0.015
        s.x += s.vx
        s.y += s.vy
        s.size += 0.2

        if (s.life <= 0) { state.steam.splice(i, 1); continue }

        ctx.save()
        ctx.globalAlpha = s.life * 0.18
        ctx.fillStyle = '#AAAAFF'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      if (progress >= 0.7 && progress < 0.9) {
        const flashP = (progress - 0.7) / 0.2
        const flashOpacity = Math.sin(flashP * Math.PI) * 0.7

        ctx.save()
        const flashGrad = ctx.createRadialGradient(originX, surfaceY, 0, originX, surfaceY, 80)
        flashGrad.addColorStop(0, `rgba(255,255,255,${flashOpacity})`)
        flashGrad.addColorStop(0.3, `rgba(157,0,255,${flashOpacity * 0.7})`)
        flashGrad.addColorStop(0.6, `rgba(0,255,102,${flashOpacity * 0.5})`)
        flashGrad.addColorStop(1, 'rgba(255,215,0,0)')
        ctx.beginPath()
        ctx.arc(originX, surfaceY, 80, 0, Math.PI * 2)
        ctx.fillStyle = flashGrad
        ctx.fill()
        ctx.restore()
      }

      for (let i = state.sparkles.length - 1; i >= 0; i--) {
        const sp = state.sparkles[i]
        sp.life -= 0.03
        sp.x += sp.vx
        sp.y += sp.vy
        sp.vy += 0.02

        if (sp.life <= 0) { state.sparkles.splice(i, 1); continue }

        ctx.save()
        ctx.globalAlpha = sp.life
        ctx.shadowColor = sp.color
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, sp.size * sp.life, 0, Math.PI * 2)
        ctx.fillStyle = sp.color
        ctx.fill()
        ctx.restore()
      }
    }
  })()
})

interface ScrollState {
  sealSparkles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }>
  pulseAngle: number
}

registerCelebration({
  id: 'scroll-seal',
  name: 'Scroll Seal',
  category: 'medieval',
  duration: 1800,
  render: (() => {
    let state: ScrollState | null = null
    return (c: CelebrationContext) => {
      const { ctx, originX, originY, progress, elapsed } = c
      if (!state) {
        state = { sealSparkles: [], pulseAngle: 0 }
      }

      if (progress >= 1) { state = null; return }

      state.pulseAngle += 0.05

      const parchmentLight = '#E8C99A'
      const parchmentDark = '#D4A574'
      const parchmentInner = '#F5E6C8'
      const sealRed = '#B22222'
      const sealRedDark = '#8B0000'
      const sealHighlight = '#CC3333'
      const goldColor = '#FFD700'

      const maxUnfurlW = 110
      const scrollH = 52
      const scrollY = originY - scrollH / 2

      const overallOpacity = progress > 0.85 ? 1 - easeIn((progress - 0.85) / 0.15) : 1

      ctx.save()
      ctx.globalAlpha = overallOpacity

      if (progress < 0.25) {
        const p = easeOutBack(Math.min(progress / 0.25, 1))
        const currentW = maxUnfurlW * p

        if (currentW > 0) {
          ctx.save()
          ctx.shadowColor = parchmentDark
          ctx.shadowBlur = 14

          ctx.beginPath()
          ctx.moveTo(originX - currentW, scrollY + 8)
          ctx.lineTo(originX - currentW + 10, scrollY)
          ctx.lineTo(originX, scrollY)
          ctx.lineTo(originX, scrollY + scrollH)
          ctx.lineTo(originX - currentW + 10, scrollY + scrollH)
          ctx.lineTo(originX - currentW, scrollY + scrollH - 8)
          ctx.closePath()
          const leftGrad = ctx.createLinearGradient(originX - currentW, 0, originX, 0)
          leftGrad.addColorStop(0, parchmentDark)
          leftGrad.addColorStop(0.15, parchmentLight)
          leftGrad.addColorStop(0.5, parchmentInner)
          leftGrad.addColorStop(1, parchmentLight)
          ctx.fillStyle = leftGrad
          ctx.fill()
          ctx.strokeStyle = parchmentDark
          ctx.lineWidth = 1.5
          ctx.stroke()
          ctx.restore()

          ctx.save()
          ctx.shadowColor = parchmentDark
          ctx.shadowBlur = 14

          ctx.beginPath()
          ctx.moveTo(originX + currentW, scrollY + 8)
          ctx.lineTo(originX + currentW - 10, scrollY)
          ctx.lineTo(originX, scrollY)
          ctx.lineTo(originX, scrollY + scrollH)
          ctx.lineTo(originX + currentW - 10, scrollY + scrollH)
          ctx.lineTo(originX + currentW, scrollY + scrollH - 8)
          ctx.closePath()
          const rightGrad = ctx.createLinearGradient(originX, 0, originX + currentW, 0)
          rightGrad.addColorStop(0, parchmentLight)
          rightGrad.addColorStop(0.5, parchmentInner)
          rightGrad.addColorStop(0.85, parchmentLight)
          rightGrad.addColorStop(1, parchmentDark)
          ctx.fillStyle = rightGrad
          ctx.fill()
          ctx.strokeStyle = parchmentDark
          ctx.lineWidth = 1.5
          ctx.stroke()
          ctx.restore()

          ctx.save()
          ctx.strokeStyle = 'rgba(139,90,43,0.25)'
          ctx.lineWidth = 1
          for (let y = scrollY + 12; y < scrollY + scrollH - 8; y += 8) {
            ctx.beginPath()
            ctx.moveTo(originX - currentW * 0.7, y)
            ctx.lineTo(originX + currentW * 0.7, y)
            ctx.stroke()
          }
          ctx.restore()
        }
      }

      if (progress >= 0.25 && progress < 0.85) {
        ctx.save()
        ctx.shadowColor = parchmentDark
        ctx.shadowBlur = 14

        ctx.beginPath()
        ctx.moveTo(originX - maxUnfurlW, scrollY + 8)
        ctx.lineTo(originX - maxUnfurlW + 10, scrollY)
        ctx.lineTo(originX, scrollY)
        ctx.lineTo(originX, scrollY + scrollH)
        ctx.lineTo(originX - maxUnfurlW + 10, scrollY + scrollH)
        ctx.lineTo(originX - maxUnfurlW, scrollY + scrollH - 8)
        ctx.closePath()
        const leftGrad = ctx.createLinearGradient(originX - maxUnfurlW, 0, originX, 0)
        leftGrad.addColorStop(0, parchmentDark)
        leftGrad.addColorStop(0.15, parchmentLight)
        leftGrad.addColorStop(0.5, parchmentInner)
        leftGrad.addColorStop(1, parchmentLight)
        ctx.fillStyle = leftGrad
        ctx.fill()
        ctx.strokeStyle = parchmentDark
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()

        ctx.save()
        ctx.shadowColor = parchmentDark
        ctx.shadowBlur = 14

        ctx.beginPath()
        ctx.moveTo(originX + maxUnfurlW, scrollY + 8)
        ctx.lineTo(originX + maxUnfurlW - 10, scrollY)
        ctx.lineTo(originX, scrollY)
        ctx.lineTo(originX, scrollY + scrollH)
        ctx.lineTo(originX + maxUnfurlW - 10, scrollY + scrollH)
        ctx.lineTo(originX + maxUnfurlW, scrollY + scrollH - 8)
        ctx.closePath()
        const rightGrad = ctx.createLinearGradient(originX, 0, originX + maxUnfurlW, 0)
        rightGrad.addColorStop(0, parchmentLight)
        rightGrad.addColorStop(0.5, parchmentInner)
        rightGrad.addColorStop(0.85, parchmentLight)
        rightGrad.addColorStop(1, parchmentDark)
        ctx.fillStyle = rightGrad
        ctx.fill()
        ctx.strokeStyle = parchmentDark
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()

        ctx.save()
        ctx.strokeStyle = 'rgba(139,90,43,0.2)'
        ctx.lineWidth = 1
        for (let y = scrollY + 12; y < scrollY + scrollH - 8; y += 8) {
          ctx.beginPath()
          ctx.moveTo(originX - maxUnfurlW * 0.65, y)
          ctx.lineTo(originX + maxUnfurlW * 0.65, y)
          ctx.stroke()
        }
        ctx.restore()
      }

      if (progress >= 0.25 && progress < 0.85) {
        const sealP = Math.min((progress - 0.25) / 0.25, 1)
        const sealRadius = 28 * easeOutBack(sealP)
        const sealX = originX
        const sealY = originY

        ctx.save()
        ctx.shadowColor = sealRed
        ctx.shadowBlur = 16 * sealP

        const shadowGrad = ctx.createRadialGradient(sealX + 2, sealY + 2, 0, sealX + 2, sealY + 2, sealRadius)
        shadowGrad.addColorStop(0, 'rgba(0,0,0,0.25)')
        shadowGrad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(sealX + 2, sealY + 2, sealRadius, 0, Math.PI * 2)
        ctx.fillStyle = shadowGrad
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.shadowColor = sealRed
        ctx.shadowBlur = 12 * sealP

        const sealGrad = ctx.createRadialGradient(sealX - sealRadius * 0.3, sealY - sealRadius * 0.3, 0, sealX, sealY, sealRadius)
        sealGrad.addColorStop(0, sealHighlight)
        sealGrad.addColorStop(0.4, sealRed)
        sealGrad.addColorStop(1, sealRedDark)
        ctx.beginPath()
        ctx.arc(sealX, sealY, sealRadius, 0, Math.PI * 2)
        ctx.fillStyle = sealGrad
        ctx.fill()

        ctx.strokeStyle = sealRedDark
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()

        if (sealP > 0.6) {
          const stampP = (sealP - 0.6) / 0.4
          ctx.save()
          ctx.globalAlpha = easeOut(stampP) * overallOpacity
          ctx.shadowColor = 'rgba(255,200,180,0.5)'
          ctx.shadowBlur = 5
          ctx.strokeStyle = 'rgba(255,220,200,0.75)'
          ctx.lineWidth = 1.5
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          const crownPoints = 5
          const crownBaseY = sealY + sealRadius * 0.32
          const crownTopY = sealY - sealRadius * 0.38
          const crownW = sealRadius * 0.7
          ctx.beginPath()
          ctx.moveTo(sealX - crownW * 0.5, crownBaseY)
          ctx.lineTo(sealX - crownW * 0.5, crownBaseY - sealRadius * 0.18)
          ctx.lineTo(sealX - crownW * 0.28, crownTopY + sealRadius * 0.1)
          ctx.lineTo(sealX - crownW * 0.15, crownTopY + sealRadius * 0.2)
          ctx.lineTo(sealX, crownTopY)
          ctx.lineTo(sealX + crownW * 0.15, crownTopY + sealRadius * 0.2)
          ctx.lineTo(sealX + crownW * 0.28, crownTopY + sealRadius * 0.1)
          ctx.lineTo(sealX + crownW * 0.5, crownBaseY - sealRadius * 0.18)
          ctx.lineTo(sealX + crownW * 0.5, crownBaseY)
          ctx.closePath()
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(sealX - crownW * 0.28, crownTopY + sealRadius * 0.1, 2, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,230,200,0.7)'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(sealX, crownTopY, 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(sealX + crownW * 0.28, crownTopY + sealRadius * 0.1, 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      if (progress >= 0.5 && progress < 0.85) {
        const pulseP = (progress - 0.5) / 0.35
        const pulseRadius = 28 + Math.sin(state.pulseAngle) * 6
        const pulseOpacity = (0.4 + Math.sin(state.pulseAngle * 1.3) * 0.2) * (1 - pulseP * 0.4)

        ctx.save()
        ctx.shadowColor = goldColor
        ctx.shadowBlur = 20
        ctx.strokeStyle = `rgba(255,215,0,${pulseOpacity * overallOpacity})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(originX, originY, pulseRadius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()

        const sparkleRate = 90
        if (elapsed % sparkleRate < 20) {
          for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2
            const r = 28 + Math.random() * 14
            state.sealSparkles.push({
              x: originX + Math.cos(angle) * r,
              y: originY + Math.sin(angle) * r,
              vx: Math.cos(angle) * (0.4 + Math.random() * 0.6),
              vy: Math.sin(angle) * (0.4 + Math.random() * 0.6) - 0.5,
              life: 1,
              color: Math.random() > 0.5 ? goldColor : '#FFF8DC',
              size: 1.5 + Math.random() * 2.5,
            })
          }
        }
      }

      for (let i = state.sealSparkles.length - 1; i >= 0; i--) {
        const sp = state.sealSparkles[i]
        sp.life -= 0.025
        sp.x += sp.vx
        sp.y += sp.vy
        sp.vy -= 0.01

        if (sp.life <= 0) { state.sealSparkles.splice(i, 1); continue }

        ctx.save()
        ctx.globalAlpha = sp.life * overallOpacity
        ctx.shadowColor = sp.color
        ctx.shadowBlur = 8
        ctx.beginPath()

        const hs = sp.size * sp.life
        ctx.moveTo(sp.x, sp.y - hs * 2)
        ctx.lineTo(sp.x + hs * 0.5, sp.y - hs * 0.5)
        ctx.lineTo(sp.x + hs * 2, sp.y)
        ctx.lineTo(sp.x + hs * 0.5, sp.y + hs * 0.5)
        ctx.lineTo(sp.x, sp.y + hs * 2)
        ctx.lineTo(sp.x - hs * 0.5, sp.y + hs * 0.5)
        ctx.lineTo(sp.x - hs * 2, sp.y)
        ctx.lineTo(sp.x - hs * 0.5, sp.y - hs * 0.5)
        ctx.closePath()
        ctx.fillStyle = sp.color
        ctx.fill()
        ctx.restore()
      }

      if (progress >= 0.7 && progress < 1) {
        const rollP = easeIn((progress - 0.7) / 0.3)
        const currentW = maxUnfurlW * (1 - rollP)

        if (currentW > 0 && progress >= 0.85) {
          ctx.save()
          ctx.shadowColor = parchmentDark
          ctx.shadowBlur = 8

          ctx.beginPath()
          ctx.moveTo(originX - currentW, scrollY + 8)
          ctx.lineTo(originX - currentW + 10, scrollY)
          ctx.lineTo(originX, scrollY)
          ctx.lineTo(originX, scrollY + scrollH)
          ctx.lineTo(originX - currentW + 10, scrollY + scrollH)
          ctx.lineTo(originX - currentW, scrollY + scrollH - 8)
          ctx.closePath()
          ctx.fillStyle = parchmentLight
          ctx.fill()
          ctx.restore()

          ctx.save()
          ctx.beginPath()
          ctx.moveTo(originX + currentW, scrollY + 8)
          ctx.lineTo(originX + currentW - 10, scrollY)
          ctx.lineTo(originX, scrollY)
          ctx.lineTo(originX, scrollY + scrollH)
          ctx.lineTo(originX + currentW - 10, scrollY + scrollH)
          ctx.lineTo(originX + currentW, scrollY + scrollH - 8)
          ctx.closePath()
          ctx.fillStyle = parchmentLight
          ctx.fill()
          ctx.restore()
        }
      }

      ctx.restore()
    }
  })()
})
