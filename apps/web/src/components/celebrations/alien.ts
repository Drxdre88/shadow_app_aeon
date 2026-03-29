import { registerCelebration } from './registry'
import type { CelebrationContext } from './types'

const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t * t
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

registerCelebration({
  id: 'abduction-beam',
  name: 'Abduction Beam',
  category: 'alien',
  duration: 2200,
  render: (() => {
    interface BeamParticle {
      x: number
      y: number
      vy: number
      size: number
      alpha: number
      phase: number
    }
    let particles: BeamParticle[] | null = null

    return (c: CelebrationContext) => {
      if (!particles) {
        particles = Array.from({ length: 24 }, () => ({
          x: lerp(-0.3, 0.3, Math.random()),
          y: Math.random(),
          vy: -(0.003 + Math.random() * 0.004),
          size: 2 + Math.random() * 3,
          alpha: 0.4 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
        }))
      }

      const { ctx, originX, originY, width, height, progress, elapsed } = c

      const phase1End = 0.2
      const phase2End = 0.6

      const beamTopX = originX
      const beamTopY = 0
      const halfWidthAtTop = width * 0.18

      let beamProgress = 0
      let beamAlpha = 0
      let beamCurrentBottom = beamTopY

      if (progress <= phase1End) {
        const t = progress / phase1End
        beamProgress = easeOut(t)
        beamAlpha = t * 0.7
        beamCurrentBottom = beamTopY + (originY - beamTopY) * beamProgress
      } else if (progress <= phase2End) {
        beamProgress = 1
        const flicker = 0.6 + 0.1 * Math.sin(elapsed * 0.02) + 0.05 * Math.sin(elapsed * 0.073)
        beamAlpha = flicker
        beamCurrentBottom = originY
      } else {
        const t = (progress - phase2End) / (1 - phase2End)
        beamProgress = 1 - easeIn(t)
        beamAlpha = (1 - t) * 0.7
        beamCurrentBottom = beamTopY + (originY - beamTopY) * beamProgress
      }

      if (beamAlpha > 0 && beamCurrentBottom > beamTopY) {
        ctx.save()

        const grad = ctx.createLinearGradient(originX, beamTopY, originX, beamCurrentBottom)
        grad.addColorStop(0, `rgba(0,255,102,${beamAlpha * 0.85})`)
        grad.addColorStop(0.5, `rgba(0,255,102,${beamAlpha * 0.45})`)
        grad.addColorStop(1, `rgba(0,255,102,${beamAlpha * 0.1})`)

        const progressRatio = (beamCurrentBottom - beamTopY) / (originY - beamTopY || 1)
        const halfWidthAtBottom = halfWidthAtTop * progressRatio * 0.15

        ctx.beginPath()
        ctx.moveTo(beamTopX - halfWidthAtTop * progressRatio, beamTopY)
        ctx.lineTo(beamTopX + halfWidthAtTop * progressRatio, beamTopY)
        ctx.lineTo(originX + halfWidthAtBottom, beamCurrentBottom)
        ctx.lineTo(originX - halfWidthAtBottom, beamCurrentBottom)
        ctx.closePath()

        ctx.shadowColor = '#00ff66'
        ctx.shadowBlur = 25
        ctx.fillStyle = grad
        ctx.fill()

        const lineCount = 12
        for (let i = 0; i < lineCount; i++) {
          const scanY = beamTopY + ((beamCurrentBottom - beamTopY) * ((i / lineCount + (elapsed * 0.0008 % 1)) % 1))
          const scanProgress = (scanY - beamTopY) / (beamCurrentBottom - beamTopY || 1)
          const scanHalfW = halfWidthAtTop * scanProgress * progressRatio
          const lineAlpha = beamAlpha * 0.25 * (1 - scanProgress * 0.5)

          ctx.beginPath()
          ctx.moveTo(beamTopX - scanHalfW, scanY)
          ctx.lineTo(beamTopX + scanHalfW, scanY)
          ctx.strokeStyle = `rgba(0,255,102,${lineAlpha})`
          ctx.lineWidth = 1
          ctx.shadowBlur = 8
          ctx.shadowColor = '#00ff66'
          ctx.stroke()
        }

        ctx.restore()
      }

      if (progress > phase1End && beamCurrentBottom > beamTopY) {
        const speedMult = progress > phase2End ? 1 + ((progress - phase2End) / (1 - phase2End)) * 4 : 1

        for (const p of particles!) {
          p.y += p.vy * speedMult
          if (p.y < 0) {
            p.y = 1
            p.x = lerp(-0.25, 0.25, Math.random())
          }

          const beamRatio = (originY - beamTopY) || 1
          const absY = beamTopY + p.y * (beamCurrentBottom - beamTopY)
          const pProgress = (absY - beamTopY) / beamRatio
          const maxX = halfWidthAtTop * pProgress * 0.9
          const absX = originX + p.x * maxX * 2

          const pulseAlpha = p.alpha * (0.7 + 0.3 * Math.sin(elapsed * 0.01 + p.phase)) * beamAlpha

          ctx.save()
          ctx.shadowColor = '#00ff66'
          ctx.shadowBlur = 12
          ctx.fillStyle = `rgba(180,255,200,${pulseAlpha})`
          ctx.beginPath()
          ctx.arc(absX, absY, p.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      if (progress >= 1) particles = null
    }
  })(),
})

registerCelebration({
  id: 'acid-dissolve',
  name: 'Acid Dissolve',
  category: 'alien',
  duration: 2400,
  render: (() => {
    interface AcidDrop {
      x: number
      y: number
      vx: number
      vy: number
      size: number
      maxSize: number
      alpha: number
      blobSeeds: number[]
      trailPoints: { x: number; y: number; alpha: number }[]
      pooled: boolean
      poolSize: number
      poolTargetSize: number
      spawnTime: number
    }
    interface VaporParticle {
      x: number
      y: number
      vx: number
      vy: number
      alpha: number
      size: number
      life: number
    }
    interface SizzleSpark {
      x: number
      y: number
      alpha: number
      life: number
      size: number
    }
    interface BlobState {
      drops: AcidDrop[]
      vapors: VaporParticle[]
      sizzles: SizzleSpark[]
      lastVaporTime: number
      lastSizzleTime: number
      blobPhase: number
      blobSeeds: number[]
      ruptureFired: boolean
    }
    let state: BlobState | null = null

    const drawOrganicBlob = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      baseR: number,
      seeds: number[],
      wobbleT: number,
      pointCount: number
    ) => {
      ctx.beginPath()
      for (let i = 0; i <= pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2
        const si = i % seeds.length
        const wobble = 1 + seeds[si] * (0.7 + 0.3 * Math.sin(wobbleT * 2.1 + si * 1.3))
        const r = baseR * wobble
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r * (1 + seeds[(si + 1) % seeds.length] * 0.2)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    return (c: CelebrationContext) => {
      if (!state) {
        const blobSeeds = Array.from({ length: 10 }, () => Math.random() * 0.5 - 0.25)
        const drops: AcidDrop[] = Array.from({ length: 38 }, (_, i) => {
          const angle = (Math.PI * 2 * i) / 38 + (Math.random() - 0.5) * 0.5
          const speed = 2.5 + Math.random() * 5.5
          return {
            x: c.originX,
            y: c.originY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1.5,
            size: 3 + Math.random() * 5,
            maxSize: 5 + Math.random() * 9,
            alpha: 0.9 + Math.random() * 0.1,
            blobSeeds: Array.from({ length: 6 }, () => Math.random() * 0.45 - 0.225),
            trailPoints: [],
            pooled: false,
            poolSize: 0,
            poolTargetSize: 10 + Math.random() * 18,
            spawnTime: 0.15 + Math.random() * 0.08,
          }
        })
        state = {
          drops,
          vapors: [],
          sizzles: [],
          lastVaporTime: 0,
          lastSizzleTime: 0,
          blobPhase: 0,
          blobSeeds,
          ruptureFired: false,
        }
      }

      const { ctx, originX, originY, width, height, progress, elapsed } = c

      const globalFade = progress > 0.8 ? 1 - (progress - 0.8) / 0.2 : 1

      if (progress < 0.15) {
        const t = progress / 0.15
        const blobR = 18 + easeOut(t) * 22
        const wobbleT = elapsed * 0.003

        ctx.save()
        ctx.shadowColor = '#39FF14'
        ctx.shadowBlur = 28
        const blobGrad = ctx.createRadialGradient(originX - blobR * 0.2, originY - blobR * 0.15, 0, originX, originY, blobR * 1.4)
        blobGrad.addColorStop(0, `rgba(200,255,80,${easeOut(t) * globalFade})`)
        blobGrad.addColorStop(0.35, `rgba(57,255,20,${easeOut(t) * 0.95 * globalFade})`)
        blobGrad.addColorStop(0.7, `rgba(0,180,10,${easeOut(t) * 0.6 * globalFade})`)
        blobGrad.addColorStop(1, `rgba(0,100,0,${easeOut(t) * 0.2 * globalFade})`)
        drawOrganicBlob(ctx, originX, originY, blobR, state.blobSeeds, wobbleT, 10)
        ctx.fillStyle = blobGrad
        ctx.fill()

        ctx.shadowBlur = 15
        ctx.shadowColor = '#ADFF2F'
        drawOrganicBlob(ctx, originX, originY, blobR * 0.55, state.blobSeeds.map(s => -s), wobbleT + 1.1, 8)
        const innerGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, blobR * 0.55)
        innerGrad.addColorStop(0, `rgba(230,255,150,${easeOut(t) * globalFade})`)
        innerGrad.addColorStop(1, `rgba(57,255,20,0)`)
        ctx.fillStyle = innerGrad
        ctx.fill()
        ctx.restore()
      }

      if (progress >= 0.15 && elapsed - state.lastSizzleTime > 35) {
        state.lastSizzleTime = elapsed
        for (let i = 0; i < 4; i++) {
          const drop = state.drops[Math.floor(Math.random() * state.drops.length)]
          if (drop.trailPoints.length > 0) {
            const tp = drop.trailPoints[Math.floor(Math.random() * drop.trailPoints.length)]
            state.sizzles.push({
              x: tp.x + (Math.random() - 0.5) * 8,
              y: tp.y + (Math.random() - 0.5) * 8,
              alpha: 0.9 + Math.random() * 0.1,
              life: 1,
              size: 1 + Math.random() * 2,
            })
          } else {
            state.sizzles.push({
              x: drop.x + (Math.random() - 0.5) * 12,
              y: drop.y + (Math.random() - 0.5) * 12,
              alpha: 0.85,
              life: 1,
              size: 1.5 + Math.random() * 2,
            })
          }
        }
      }

      if (progress >= 0.15 && elapsed - state.lastVaporTime > 45) {
        state.lastVaporTime = elapsed
        for (let i = 0; i < 5; i++) {
          const drop = state.drops[Math.floor(Math.random() * state.drops.length)]
          state.vapors.push({
            x: drop.x + (Math.random() - 0.5) * 14,
            y: drop.y - drop.size,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -(0.5 + Math.random() * 1.1),
            alpha: 0.35 + Math.random() * 0.25,
            size: 4 + Math.random() * 7,
            life: 1,
          })
        }
      }

      for (const tp of state.drops.flatMap(d => d.trailPoints)) {
        if (tp.alpha > 0) {
          tp.alpha -= 0.004
          ctx.save()
          ctx.fillStyle = `rgba(0,30,0,${Math.max(0, tp.alpha) * globalFade})`
          ctx.beginPath()
          ctx.arc(tp.x, tp.y, 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      for (const drop of state.drops) {
        if (progress < drop.spawnTime) continue

        if (!drop.pooled && progress < 0.5) {
          drop.vy += 0.055
          drop.vx *= 0.985
          drop.x += drop.vx
          drop.y += drop.vy

          if (Math.random() < 0.35) {
            drop.trailPoints.push({ x: drop.x, y: drop.y, alpha: 0.55 })
            if (drop.trailPoints.length > 14) drop.trailPoints.shift()
          }
        } else if (!drop.pooled && progress >= 0.5) {
          drop.pooled = true
        }

        if (drop.pooled) {
          drop.poolSize = Math.min(drop.poolTargetSize, drop.poolSize + 0.25)
        }

        const wobbleT = elapsed * 0.004 + drop.blobSeeds[0] * 10

        if (drop.pooled) {
          const pAlpha = drop.alpha * globalFade
          if (pAlpha > 0.01) {
            ctx.save()
            ctx.shadowColor = '#00FF41'
            ctx.shadowBlur = 18
            const pudGrad = ctx.createRadialGradient(drop.x, drop.y, 0, drop.x, drop.y, drop.poolSize * 1.2)
            pudGrad.addColorStop(0, `rgba(0,80,0,${pAlpha * 0.85})`)
            pudGrad.addColorStop(0.6, `rgba(0,50,0,${pAlpha * 0.6})`)
            pudGrad.addColorStop(0.85, `rgba(57,255,20,${pAlpha * 0.4})`)
            pudGrad.addColorStop(1, `rgba(0,0,0,0)`)
            drawOrganicBlob(ctx, drop.x, drop.y, drop.poolSize, drop.blobSeeds, wobbleT, 6)
            ctx.fillStyle = pudGrad
            ctx.fill()
            ctx.restore()
          }
        } else {
          const dAlpha = drop.alpha * globalFade
          if (dAlpha > 0.01) {
            ctx.save()
            ctx.shadowColor = '#39FF14'
            ctx.shadowBlur = 22
            const dGrad = ctx.createRadialGradient(drop.x - drop.size * 0.15, drop.y - drop.size * 0.1, 0, drop.x, drop.y, drop.size * 1.5)
            dGrad.addColorStop(0, `rgba(210,255,90,${dAlpha})`)
            dGrad.addColorStop(0.4, `rgba(57,255,20,${dAlpha * 0.9})`)
            dGrad.addColorStop(1, `rgba(0,180,10,${dAlpha * 0.3})`)
            drawOrganicBlob(ctx, drop.x, drop.y, drop.size, drop.blobSeeds, wobbleT, 6)
            ctx.fillStyle = dGrad
            ctx.fill()
            ctx.restore()
          }
        }
      }

      for (const v of state.vapors) {
        v.x += v.vx
        v.y += v.vy
        v.life -= 0.009
        v.alpha = v.life * 0.3 * globalFade
        v.size += 0.2
        if (v.alpha > 0.01) {
          ctx.save()
          ctx.shadowColor = '#39FF14'
          ctx.shadowBlur = 10
          ctx.fillStyle = `rgba(100,255,80,${v.alpha})`
          ctx.beginPath()
          ctx.arc(v.x, v.y, v.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
      state.vapors = state.vapors.filter(v => v.life > 0)

      for (const s of state.sizzles) {
        s.life -= 0.08
        s.alpha = s.life * globalFade
        if (s.alpha > 0.01) {
          ctx.save()
          ctx.shadowColor = '#ffffff'
          ctx.shadowBlur = 6
          const sparkColor = Math.random() < 0.5 ? `rgba(255,255,200,${s.alpha})` : `rgba(220,255,100,${s.alpha})`
          ctx.fillStyle = sparkColor
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
      state.sizzles = state.sizzles.filter(s => s.life > 0)

      if (progress > 0.8) {
        const hazeAlpha = (1 - (progress - 0.8) / 0.2) * 0.06
        ctx.save()
        const hazeGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, Math.max(width, height) * 0.55)
        hazeGrad.addColorStop(0, `rgba(0,255,20,${hazeAlpha})`)
        hazeGrad.addColorStop(0.5, `rgba(0,180,10,${hazeAlpha * 0.4})`)
        hazeGrad.addColorStop(1, `rgba(0,0,0,0)`)
        ctx.fillStyle = hazeGrad
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }

      if (progress >= 1) state = null
    }
  })(),
})

registerCelebration({
  id: 'warp-drive',
  name: 'Warp Drive',
  category: 'alien',
  duration: 1800,
  render: (() => {
    interface WarpStar {
      x: number
      y: number
      angle: number
      dist: number
      speed: number
      brightness: number
    }
    let stars: WarpStar[] | null = null

    return (c: CelebrationContext) => {
      if (!stars) {
        stars = Array.from({ length: 60 }, () => {
          const angle = Math.random() * Math.PI * 2
          const dist = 20 + Math.random() * Math.max(c.width, c.height) * 0.6
          return {
            x: c.originX + Math.cos(angle) * dist,
            y: c.originY + Math.sin(angle) * dist,
            angle,
            dist,
            speed: 0.8 + Math.random() * 1.4,
            brightness: 0.5 + Math.random() * 0.5,
          }
        })
      }

      const { ctx, originX, originY, width, height, progress, elapsed } = c

      const phase1End = 0.3
      const phase2End = 0.7
      const peakFlash = 0.5

      let warpIntensity = 0
      if (progress <= phase1End) {
        warpIntensity = easeIn(progress / phase1End)
      } else if (progress <= phase2End) {
        warpIntensity = 1
      } else {
        warpIntensity = easeOut(1 - (progress - phase2End) / (1 - phase2End))
      }

      const flashDist = Math.abs(progress - peakFlash)
      if (flashDist < 0.06) {
        const flashAlpha = (1 - flashDist / 0.06) * 0.5
        ctx.save()
        const flashGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, Math.max(width, height))
        flashGrad.addColorStop(0, `rgba(220,240,255,${flashAlpha})`)
        flashGrad.addColorStop(0.3, `rgba(100,180,255,${flashAlpha * 0.4})`)
        flashGrad.addColorStop(1, `rgba(0,0,0,0)`)
        ctx.fillStyle = flashGrad
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }

      for (const star of stars) {
        const stretchLen = warpIntensity * star.speed * 60 * warpIntensity
        const dotSize = 1.5 + star.brightness * 1.5 * (1 - warpIntensity * 0.8)

        const dx = star.x - originX
        const dy = star.y - originY
        const angle = Math.atan2(dy, dx)

        const trailEndX = star.x - Math.cos(angle) * stretchLen
        const trailEndY = star.y - Math.sin(angle) * stretchLen

        const alpha = star.brightness * warpIntensity
        const fadeAlpha = progress > phase2End ? alpha * easeOut(1 - (progress - phase2End) / (1 - phase2End)) : alpha

        if (fadeAlpha < 0.01) continue

        ctx.save()

        if (stretchLen > 2) {
          const streakGrad = ctx.createLinearGradient(trailEndX, trailEndY, star.x, star.y)
          streakGrad.addColorStop(0, `rgba(0,170,255,${fadeAlpha * 0.8})`)
          streakGrad.addColorStop(0.6, `rgba(150,210,255,${fadeAlpha * 0.6})`)
          streakGrad.addColorStop(1, `rgba(255,255,255,${fadeAlpha})`)

          ctx.beginPath()
          ctx.moveTo(trailEndX, trailEndY)
          ctx.lineTo(star.x, star.y)
          ctx.strokeStyle = streakGrad
          ctx.lineWidth = 0.8 + star.brightness * 1.2
          ctx.shadowColor = '#00aaff'
          ctx.shadowBlur = 6 * warpIntensity
          ctx.stroke()
        } else {
          ctx.shadowColor = '#ffffff'
          ctx.shadowBlur = 4
          ctx.fillStyle = `rgba(255,255,255,${fadeAlpha})`
          ctx.beginPath()
          ctx.arc(star.x, star.y, dotSize, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.restore()

        if (warpIntensity > 0.05) {
          star.dist += star.speed * warpIntensity * 2.5
          star.x = originX + Math.cos(star.angle) * star.dist
          star.y = originY + Math.sin(star.angle) * star.dist

          const maxDist = Math.sqrt(width * width + height * height)
          if (star.dist > maxDist * 0.7) {
            star.dist = 20 + Math.random() * 40
            star.angle = Math.random() * Math.PI * 2
            star.x = originX + Math.cos(star.angle) * star.dist
            star.y = originY + Math.sin(star.angle) * star.dist
            star.speed = 0.8 + Math.random() * 1.4
            star.brightness = 0.5 + Math.random() * 0.5
          }
        }
      }

      if (progress >= 1) stars = null
    }
  })(),
})

registerCelebration({
  id: 'plasma-rift',
  name: 'Plasma Rift',
  category: 'alien',
  duration: 2400,
  render: (() => {
    interface RiftParticle {
      x: number
      y: number
      vx: number
      vy: number
      alpha: number
      size: number
    }
    interface LightningArc {
      points: { x: number; y: number }[]
      alpha: number
      life: number
    }
    interface AlienSymbol {
      x: number
      y: number
      type: number
      alpha: number
      size: number
      birth: number
    }
    interface State {
      zigzag: number[]
      suckParticles: RiftParticle[]
      sparks: RiftParticle[]
      arcs: LightningArc[]
      symbols: AlienSymbol[]
      lastArcTime: number
      lastSymbolTime: number
      lastSparkTime: number
    }
    let state: State | null = null

    const makeZigzag = (segments: number): number[] => {
      const offsets: number[] = []
      for (let i = 0; i <= segments; i++) {
        offsets.push((Math.random() - 0.5) * 18)
      }
      offsets[0] = 0
      offsets[segments] = 0
      return offsets
    }

    const makeArc = (ox: number, oy: number, halfW: number, halfH: number): LightningArc => {
      const steps = 7 + Math.floor(Math.random() * 4)
      const points: { x: number; y: number }[] = []
      const side = Math.random() < 0.5 ? -1 : 1
      const startY = oy - halfH * (0.5 + Math.random() * 0.4)
      const endY = oy + halfH * (0.5 + Math.random() * 0.4)
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const y = lerp(startY, endY, t)
        const edgeX = ox + side * halfW * (0.8 + Math.random() * 0.4)
        const crossX = ox - side * halfW * (0.3 + Math.random() * 0.5)
        const x = lerp(edgeX, crossX, Math.sin(t * Math.PI))
        points.push({ x: x + (Math.random() - 0.5) * 10, y })
      }
      return { points, alpha: 1, life: 1 }
    }

    const drawSymbol = (ctx: CanvasRenderingContext2D, type: number, x: number, y: number, size: number, alpha: number) => {
      ctx.save()
      ctx.strokeStyle = `rgba(57,255,20,${alpha})`
      ctx.lineWidth = 1.5
      ctx.shadowColor = '#39FF14'
      ctx.shadowBlur = 8
      if (type === 0) {
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, y - size * 1.4)
        ctx.lineTo(x, y + size * 1.4)
        ctx.moveTo(x - size * 1.4, y)
        ctx.lineTo(x + size * 1.4, y)
        ctx.stroke()
      } else if (type === 1) {
        ctx.beginPath()
        ctx.moveTo(x, y - size)
        ctx.lineTo(x + size * 0.87, y + size * 0.5)
        ctx.lineTo(x - size * 0.87, y + size * 0.5)
        ctx.closePath()
        ctx.stroke()
        ctx.save()
        ctx.fillStyle = `rgba(57,255,20,${alpha * 0.5})`
        ctx.beginPath()
        ctx.arc(x, y + size * 0.15, size * 0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (type === 2) {
        const r = size
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6
          const nx = x + Math.cos(a) * r
          const ny = y + Math.sin(a) * r
          i === 0 ? ctx.moveTo(nx, ny) : ctx.lineTo(nx, ny)
        }
        ctx.closePath()
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(x, y, size * 0.4, 0, Math.PI * 2)
        ctx.stroke()
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(x + Math.cos(a) * size * 0.4, y + Math.sin(a) * size * 0.4)
          ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    return (c: CelebrationContext) => {
      if (!state) {
        state = {
          zigzag: makeZigzag(9),
          suckParticles: Array.from({ length: 24 }, () => {
            const angle = Math.random() * Math.PI * 2
            const dist = 60 + Math.random() * Math.max(c.width, c.height) * 0.25
            return {
              x: c.originX + Math.cos(angle) * dist,
              y: c.originY + Math.sin(angle) * dist,
              vx: 0,
              vy: 0,
              alpha: 0.5 + Math.random() * 0.4,
              size: 2 + Math.random() * 3,
            }
          }),
          sparks: [],
          arcs: [],
          symbols: [],
          lastArcTime: 0,
          lastSymbolTime: 0,
          lastSparkTime: 0,
        }
      }

      const { ctx, originX, originY, progress, elapsed } = c

      const phase1End = 0.2
      const phase2End = 0.6
      const phase3End = 0.85

      let riftHeight = 0
      let riftHalfW = 0
      let masterAlpha = 1

      if (progress <= phase1End) {
        const t = easeOut(progress / phase1End)
        riftHeight = t * 70
        riftHalfW = 0
        masterAlpha = t
      } else if (progress <= phase2End) {
        const t = easeOut((progress - phase1End) / (phase2End - phase1End))
        riftHeight = 70
        riftHalfW = t * 28
        masterAlpha = 1
      } else if (progress <= phase3End) {
        const t = (progress - phase2End) / (phase3End - phase2End)
        const pulse = 1 + 0.12 * Math.sin(t * Math.PI * 6)
        riftHeight = 70 * pulse
        riftHalfW = 28 * (0.9 + 0.1 * Math.sin(t * Math.PI * 5))
        masterAlpha = 1
      } else {
        const t = easeIn((progress - phase3End) / (1 - phase3End))
        riftHeight = 70 * (1 - t)
        riftHalfW = 28 * (1 - t)
        masterAlpha = 1 - t * 0.8
      }

      if (progress > phase2End && progress <= phase3End) {
        const shockT = (progress - phase2End) / (phase3End - phase2End)
        if (shockT > 0 && shockT < 0.5) {
          const shockR = shockT * 2 * 120
          const shockAlpha = (1 - shockT * 2) * 0.6
          ctx.save()
          ctx.shadowColor = '#00FFFF'
          ctx.shadowBlur = 20
          ctx.strokeStyle = `rgba(0,255,255,${shockAlpha})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(originX, originY, shockR, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }

      if (progress > phase1End && progress < phase3End) {
        if (elapsed - state.lastArcTime > 100) {
          state.lastArcTime = elapsed
          state.arcs.push(makeArc(originX, originY, riftHalfW + 6, riftHeight))
        }
      }

      for (const arc of state.arcs) {
        arc.life -= 0.055
        arc.alpha = arc.life
        if (arc.alpha > 0) {
          ctx.save()
          ctx.shadowColor = '#00FFFF'
          ctx.shadowBlur = 15
          ctx.strokeStyle = `rgba(157,0,255,${arc.alpha * masterAlpha})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(arc.points[0].x, arc.points[0].y)
          for (let i = 1; i < arc.points.length; i++) {
            ctx.lineTo(arc.points[i].x, arc.points[i].y)
          }
          ctx.stroke()
          ctx.restore()
        }
      }
      state.arcs = state.arcs.filter(a => a.life > 0)

      if (progress > phase1End && progress < phase2End) {
        if (elapsed - state.lastSymbolTime > 180) {
          state.lastSymbolTime = elapsed
          state.symbols.push({
            x: originX + (Math.random() - 0.5) * riftHalfW * 0.7,
            y: originY + (Math.random() - 0.5) * riftHeight * 0.6,
            type: Math.floor(Math.random() * 4),
            alpha: 0.9,
            size: 6 + Math.random() * 6,
            birth: elapsed,
          })
        }
      }

      for (const sym of state.symbols) {
        const age = (elapsed - sym.birth) / 400
        sym.alpha = Math.max(0, 0.9 * (1 - age))
        if (sym.alpha > 0) {
          drawSymbol(ctx, sym.type, sym.x, sym.y, sym.size, sym.alpha * masterAlpha)
        }
      }
      state.symbols = state.symbols.filter(s => s.alpha > 0)

      if (progress > phase1End && progress < phase2End + 0.05) {
        for (const p of state.suckParticles) {
          const dx = originX - p.x
          const dy = originY - p.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const pull = 0.25 + (riftHalfW / 28) * 0.4
          p.vx += (dx / dist) * pull
          p.vy += (dy / dist) * pull
          p.vx *= 0.88
          p.vy *= 0.88
          p.x += p.vx
          p.y += p.vy

          if (dist < 12) {
            const angle = Math.random() * Math.PI * 2
            const d = 60 + Math.random() * Math.max(c.width, c.height) * 0.25
            p.x = originX + Math.cos(angle) * d
            p.y = originY + Math.sin(angle) * d
            p.vx = 0
            p.vy = 0
          }

          ctx.save()
          ctx.shadowColor = '#9D00FF'
          ctx.shadowBlur = 10
          ctx.fillStyle = `rgba(157,0,255,${p.alpha * masterAlpha * Math.min(1, dist / 40)})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      if (progress >= phase3End) {
        if (elapsed - state.lastSparkTime > 30) {
          state.lastSparkTime = elapsed
          for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = 1.5 + Math.random() * 2.5
            state.sparks.push({
              x: originX + (Math.random() - 0.5) * riftHalfW * 2,
              y: originY + (Math.random() - 0.5) * riftHeight * 0.8,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              alpha: 0.9,
              size: 1.5 + Math.random() * 2,
            })
          }
        }
      }

      for (const sp of state.sparks) {
        sp.x += sp.vx
        sp.y += sp.vy
        sp.vx *= 0.92
        sp.vy *= 0.92
        sp.alpha -= 0.04
        if (sp.alpha > 0) {
          ctx.save()
          ctx.shadowColor = '#00FFFF'
          ctx.shadowBlur = 12
          ctx.fillStyle = `rgba(200,230,255,${sp.alpha * masterAlpha})`
          ctx.beginPath()
          ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
      state.sparks = state.sparks.filter(s => s.alpha > 0)

      if (riftHeight > 1 && masterAlpha > 0) {
        const segments = state.zigzag.length - 1
        const leftEdge: { x: number; y: number }[] = []
        const rightEdge: { x: number; y: number }[] = []

        for (let i = 0; i <= segments; i++) {
          const t = i / segments
          const y = originY - riftHeight + t * riftHeight * 2
          const jag = state.zigzag[i]
          leftEdge.push({ x: originX - riftHalfW + jag, y })
          rightEdge.push({ x: originX + riftHalfW + jag, y })
        }

        if (riftHalfW > 1) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(leftEdge[0].x, leftEdge[0].y)
          for (let i = 1; i <= segments; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y)
          for (let i = segments; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y)
          ctx.closePath()
          const voidGrad = ctx.createLinearGradient(originX - riftHalfW, 0, originX + riftHalfW, 0)
          voidGrad.addColorStop(0, `rgba(0,0,0,0)`)
          voidGrad.addColorStop(0.2, `rgba(5,0,20,${masterAlpha * 0.92})`)
          voidGrad.addColorStop(0.5, `rgba(10,0,30,${masterAlpha * 0.97})`)
          voidGrad.addColorStop(0.8, `rgba(5,0,20,${masterAlpha * 0.92})`)
          voidGrad.addColorStop(1, `rgba(0,0,0,0)`)
          ctx.fillStyle = voidGrad
          ctx.fill()
          ctx.restore()
        }

        ctx.save()
        ctx.shadowColor = '#00FFFF'
        ctx.shadowBlur = 20
        ctx.strokeStyle = `rgba(0,255,255,${masterAlpha * 0.95})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(leftEdge[0].x, leftEdge[0].y)
        for (let i = 1; i <= segments; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y)
        ctx.stroke()

        ctx.shadowColor = '#9D00FF'
        ctx.strokeStyle = `rgba(157,0,255,${masterAlpha * 0.7})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(leftEdge[0].x - 4, leftEdge[0].y)
        for (let i = 1; i <= segments; i++) ctx.lineTo(leftEdge[i].x - 4, leftEdge[i].y)
        ctx.stroke()

        ctx.shadowColor = '#00FFFF'
        ctx.shadowBlur = 20
        ctx.strokeStyle = `rgba(0,255,255,${masterAlpha * 0.95})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(rightEdge[0].x, rightEdge[0].y)
        for (let i = 1; i <= segments; i++) ctx.lineTo(rightEdge[i].x, rightEdge[i].y)
        ctx.stroke()

        ctx.shadowColor = '#9D00FF'
        ctx.strokeStyle = `rgba(157,0,255,${masterAlpha * 0.7})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(rightEdge[0].x + 4, rightEdge[0].y)
        for (let i = 1; i <= segments; i++) ctx.lineTo(rightEdge[i].x + 4, rightEdge[i].y)
        ctx.stroke()
        ctx.restore()

        const coreGlowAlpha = progress <= phase1End
          ? (progress / phase1End) * 0.9
          : masterAlpha * 0.9
        ctx.save()
        ctx.shadowColor = '#00FFFF'
        ctx.shadowBlur = 25
        const coreGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, riftHeight * 0.5)
        coreGrad.addColorStop(0, `rgba(255,255,255,${coreGlowAlpha * 0.8})`)
        coreGrad.addColorStop(0.15, `rgba(0,255,255,${coreGlowAlpha * 0.5})`)
        coreGrad.addColorStop(0.5, `rgba(157,0,255,${coreGlowAlpha * 0.15})`)
        coreGrad.addColorStop(1, `rgba(0,0,0,0)`)
        ctx.fillStyle = coreGrad
        ctx.beginPath()
        ctx.ellipse(originX, originY, riftHalfW + 6, riftHeight * 0.5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      if (progress >= phase3End && progress > 0.97) {
        const flashAlpha = ((progress - 0.97) / 0.03) * 0.7
        ctx.save()
        const flashGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, 100)
        flashGrad.addColorStop(0, `rgba(255,255,255,${flashAlpha})`)
        flashGrad.addColorStop(0.3, `rgba(0,255,255,${flashAlpha * 0.5})`)
        flashGrad.addColorStop(1, `rgba(0,0,0,0)`)
        ctx.fillStyle = flashGrad
        ctx.beginPath()
        ctx.arc(originX, originY, 100, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      if (progress >= 1) state = null
    }
  })(),
})

registerCelebration({
  id: 'portal-vortex',
  name: 'Portal Vortex',
  category: 'alien',
  duration: 2600,
  render: (() => {
    interface VortexParticle {
      angle: number
      dist: number
      speed: number
      alpha: number
      size: number
      colorIdx: number
    }
    interface LightningArc {
      points: { x: number; y: number }[]
      alpha: number
      life: number
    }
    interface State {
      particles: VortexParticle[]
      arcs: LightningArc[]
      lastArcTime: number
      rotation: number
    }
    let state: State | null = null

    const makeArc = (originX: number, originY: number, radius: number): LightningArc => {
      const startAngle = Math.random() * Math.PI * 2
      const endAngle = startAngle + (Math.PI * 0.3 + Math.random() * Math.PI * 0.5)
      const steps = 8
      const points: { x: number; y: number }[] = []
      for (let i = 0; i <= steps; i++) {
        const a = lerp(startAngle, endAngle, i / steps)
        const r = radius * (0.8 + Math.random() * 0.4)
        const jitter = (Math.random() - 0.5) * radius * 0.3
        points.push({
          x: originX + Math.cos(a) * r + jitter,
          y: originY + Math.sin(a) * r + jitter,
        })
      }
      return { points, alpha: 0.9, life: 1 }
    }

    return (c: CelebrationContext) => {
      if (!state) {
        state = {
          particles: Array.from({ length: 35 }, () => ({
            angle: Math.random() * Math.PI * 2,
            dist: 80 + Math.random() * Math.max(c.width, c.height) * 0.3,
            speed: 0.008 + Math.random() * 0.012,
            alpha: 0.6 + Math.random() * 0.4,
            size: 2 + Math.random() * 4,
            colorIdx: Math.floor(Math.random() * 3),
          })),
          arcs: [],
          lastArcTime: 0,
          rotation: 0,
        }
      }

      const { ctx, originX, originY, width, height, progress, elapsed } = c

      const phase1End = 0.2
      const phase2End = 0.7

      let portalRadius = 0
      let portalAlpha = 0
      let spinSpeed = 1

      if (progress <= phase1End) {
        const t = progress / phase1End
        portalRadius = easeOut(t) * 80
        portalAlpha = t
        spinSpeed = lerp(0.5, 1, t)
      } else if (progress <= phase2End) {
        portalRadius = 80
        portalAlpha = 1
        spinSpeed = 1
      } else {
        const t = (progress - phase2End) / (1 - phase2End)
        portalRadius = 80 * (1 - easeIn(t)) + 80 * easeIn(t) * 0.1
        spinSpeed = lerp(1, 4, easeIn(t))
        portalAlpha = 1 - t * 0.8
      }

      state.rotation += spinSpeed * 0.025

      if (progress > phase1End && progress < phase2End + 0.05) {
        if (elapsed - state.lastArcTime > 180) {
          state.lastArcTime = elapsed
          state.arcs.push(makeArc(originX, originY, portalRadius * (0.6 + Math.random() * 0.4)))
        }
      }

      for (const arc of state.arcs) {
        arc.life -= 0.04
        arc.alpha = arc.life * 0.9
        if (arc.alpha > 0) {
          const arcColors = ['#9D00FF', '#FF1493', '#00FFFF']
          const col = arcColors[Math.floor(Math.random() * 3)]
          ctx.save()
          ctx.shadowColor = col
          ctx.shadowBlur = 18
          ctx.strokeStyle = `rgba(255,255,255,${arc.alpha})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(arc.points[0].x, arc.points[0].y)
          for (let i = 1; i < arc.points.length; i++) {
            ctx.lineTo(arc.points[i].x, arc.points[i].y)
          }
          ctx.stroke()
          ctx.restore()
        }
      }
      state.arcs = state.arcs.filter(a => a.life > 0)

      const ringCount = 5
      const ringColors = ['#9D00FF', '#FF1493', '#00FFFF', '#9D00FF', '#FF1493']
      for (let r = 0; r < ringCount; r++) {
        const ringRadius = portalRadius * ((r + 1) / ringCount)
        const ringRotOffset = state.rotation * (1 + r * 0.4) * (r % 2 === 0 ? 1 : -1)
        const gapFraction = 0.25
        const arcStart = ringRotOffset
        const arcEnd = ringRotOffset + Math.PI * 2 * (1 - gapFraction)
        const ringAlpha = portalAlpha * (0.5 + 0.2 * Math.sin(elapsed * 0.003 + r))

        ctx.save()
        ctx.shadowColor = ringColors[r]
        ctx.shadowBlur = 22

        const colHex = ringColors[r]
        const alpha = ringAlpha * (0.7 + 0.3 * (r / ringCount))
        ctx.strokeStyle = colHex + Math.floor(alpha * 255).toString(16).padStart(2, '0')
        ctx.lineWidth = 2.5 - r * 0.3

        ctx.beginPath()
        ctx.arc(originX, originY, ringRadius, arcStart, arcEnd)
        ctx.stroke()
        ctx.restore()
      }

      const vortexGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, portalRadius * 0.6)
      vortexGrad.addColorStop(0, `rgba(157,0,255,${portalAlpha * 0.5})`)
      vortexGrad.addColorStop(0.4, `rgba(255,20,147,${portalAlpha * 0.2})`)
      vortexGrad.addColorStop(1, `rgba(0,255,255,0)`)
      ctx.save()
      ctx.shadowColor = '#9D00FF'
      ctx.shadowBlur = 30
      ctx.fillStyle = vortexGrad
      ctx.beginPath()
      ctx.arc(originX, originY, portalRadius * 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      const partColors = ['#9D00FF', '#FF1493', '#00FFFF']
      for (const p of state.particles) {
        const suckStrength = progress <= phase1End ? 0 : (progress > phase2End ? lerp(0.002, 0.015, (progress - phase2End) / (1 - phase2End)) : 0.002 + warpIntensityCalc(progress, phase1End, phase2End) * 0.006)
        p.dist -= suckStrength * p.dist * 0.05 + 0.5
        p.angle += p.speed * spinSpeed * (portalRadius > 0 ? 1 : 0)

        if (p.dist < 5) {
          p.dist = 80 + Math.random() * Math.max(width, height) * 0.3
          p.angle = Math.random() * Math.PI * 2
        }

        const px = originX + Math.cos(p.angle) * p.dist
        const py = originY + Math.sin(p.angle) * p.dist
        const distFade = Math.min(1, p.dist / 40)
        const fadeAlpha = p.alpha * portalAlpha * distFade

        if (fadeAlpha > 0.01) {
          ctx.save()
          ctx.shadowColor = partColors[p.colorIdx]
          ctx.shadowBlur = 10
          ctx.fillStyle = partColors[p.colorIdx] + Math.floor(fadeAlpha * 255).toString(16).padStart(2, '0')
          ctx.beginPath()
          ctx.arc(px, py, p.size * distFade, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      if (progress > phase2End + 0.05) {
        const snapT = (progress - (phase2End + 0.05)) / (1 - (phase2End + 0.05))
        if (snapT > 0.85) {
          const flashAlpha = (snapT - 0.85) / 0.15
          ctx.save()
          const snapGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, portalRadius * 3)
          snapGrad.addColorStop(0, `rgba(255,255,255,${flashAlpha * 0.8})`)
          snapGrad.addColorStop(0.2, `rgba(157,0,255,${flashAlpha * 0.4})`)
          snapGrad.addColorStop(1, `rgba(0,0,0,0)`)
          ctx.fillStyle = snapGrad
          ctx.fillRect(0, 0, width, height)
          ctx.restore()
        }
      }

      if (progress >= 1) state = null
    }
  })(),
})

function warpIntensityCalc(progress: number, phase1End: number, phase2End: number): number {
  if (progress <= phase1End) return progress / phase1End
  if (progress <= phase2End) return 1
  return 1 - (progress - phase2End) / (1 - phase2End)
}
