import { useEffect, useRef } from 'react'

interface SmokeParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  rotation: number
  rotationSpeed: number
  noiseOffsetX: number
  noiseOffsetY: number
  layer: number
}

export interface SmokeConfig {
  hue: number
  hueRange: number
  saturation: number
  baseLightness: number
  glowIntensity: number
  coreColor: [number, number, number]
  edgeColor: [number, number, number]
  composite: GlobalCompositeOperation
}

export const SMOKE_CONFIGS: Record<string, SmokeConfig> = {
  smoke: {
    hue: 0, hueRange: 0, saturation: 0, baseLightness: 15, glowIntensity: 0.2,
    coreColor: [90, 85, 80], edgeColor: [40, 38, 36],
    composite: 'source-over',
  },
  'inferno-smoke': {
    hue: 20, hueRange: 25, saturation: 90, baseLightness: 12, glowIntensity: 0.7,
    coreColor: [255, 140, 30], edgeColor: [180, 40, 5],
    composite: 'lighter',
  },
  'venom-smoke': {
    hue: 110, hueRange: 30, saturation: 80, baseLightness: 10, glowIntensity: 0.7,
    coreColor: [50, 255, 80], edgeColor: [10, 120, 20],
    composite: 'lighter',
  },
  'plasma-smoke': {
    hue: 240, hueRange: 40, saturation: 85, baseLightness: 12, glowIntensity: 0.7,
    coreColor: [130, 100, 255], edgeColor: [50, 20, 180],
    composite: 'lighter',
  },
  'blood-moon-smoke': {
    hue: 350, hueRange: 20, saturation: 85, baseLightness: 10, glowIntensity: 0.7,
    coreColor: [220, 30, 50], edgeColor: [120, 10, 20],
    composite: 'lighter',
  },
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const num = parseInt(cleaned, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function buildCustomConfig(hex: string): SmokeConfig {
  const [r, g, b] = hexToRgb(hex)
  return {
    hue: 0, hueRange: 0, saturation: 0, baseLightness: 12, glowIntensity: 0.7,
    coreColor: [r, g, b],
    edgeColor: [Math.round(r * 0.45), Math.round(g * 0.45), Math.round(b * 0.45)],
    composite: 'lighter',
  }
}

const MAX_PARTICLES = 150
const NOISE_SCALE = 0.008
const TURBULENCE_STRENGTH = 0.6

function noise2D(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)

  const hash = (a: number, b: number) => {
    let h = a * 374761393 + b * 668265263 + 1013904223
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff
  }

  const n00 = hash(ix, iy)
  const n10 = hash(ix + 1, iy)
  const n01 = hash(ix, iy + 1)
  const n11 = hash(ix + 1, iy + 1)

  const nx0 = n00 + sx * (n10 - n00)
  const nx1 = n01 + sx * (n11 - n01)
  return (nx0 + sy * (nx1 - nx0)) * 2 - 1
}

function curlNoise(x: number, y: number, time: number): [number, number] {
  const eps = 0.5
  const n1 = noise2D(x * NOISE_SCALE + time * 0.3, y * NOISE_SCALE)
  const n2 = noise2D(x * NOISE_SCALE, y * NOISE_SCALE + eps + time * 0.3)
  const n3 = noise2D(x * NOISE_SCALE + eps, y * NOISE_SCALE + time * 0.3)
  const n4 = noise2D(x * NOISE_SCALE, y * NOISE_SCALE - eps + time * 0.3)

  const curlX = (n2 - n4) / (2 * eps)
  const curlY = -(n3 - n1) / (2 * eps)
  return [curlX * TURBULENCE_STRENGTH, curlY * TURBULENCE_STRENGTH]
}

export function useSmokeEffect(containerRef: React.RefObject<HTMLDivElement | null>, variant: string, active: boolean, volume: number = 75, customColor?: string) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<SmokeParticle[]>([])
  const rafRef = useRef<number>(0)
  const mouseRef = useRef({ x: -200, y: -200 })
  const prevMouseRef = useRef({ x: -200, y: -200 })
  const timeRef = useRef(0)
  const gradientCacheRef = useRef<Map<string, CanvasGradient>>(new Map())

  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current
    const config = variant === 'custom-smoke' && customColor
      ? buildCustomConfig(customColor)
      : SMOKE_CONFIGS[variant]
    if (!config) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100;'
    canvas.width = window.innerWidth * window.devicePixelRatio
    canvas.height = window.innerHeight * window.devicePixelRatio
    container.appendChild(canvas)
    canvasRef.current = canvas

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const onResize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio
      canvas.height = window.innerHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      gradientCacheRef.current.clear()
    }
    window.addEventListener('resize', onResize)

    const vol = Math.max(0, Math.min(100, volume)) / 100
    const maxParticles = Math.max(5, Math.round(MAX_PARTICLES * vol))
    const sizeScale = 0.5 + vol * 0.5

    let isAnimating = false
    const particles = particlesRef.current

    const spawnSmoke = (x: number, y: number, velocityX: number, velocityY: number) => {
      const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY)
      const spreadFactor = Math.min(speed * 0.12, 1.5)
      const layer = Math.random()

      if (particles.length >= maxParticles) {
        const p = particles.shift()!
        Object.assign(p, {
          x, y,
          vx: -velocityX * 0.06 + (Math.random() - 0.5) * spreadFactor * 2,
          vy: -0.4 - Math.random() * 0.8 - velocityY * 0.04,
          size: (15 + Math.random() * 25 + speed * 0.5) * sizeScale,
          life: 1,
          maxLife: 35 + Math.random() * 25,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.04,
          noiseOffsetX: Math.random() * 1000,
          noiseOffsetY: Math.random() * 1000,
          layer,
        })
        particles.push(p)
        return
      }

      particles.push({
        x, y,
        vx: -velocityX * 0.06 + (Math.random() - 0.5) * spreadFactor * 2,
        vy: -0.4 - Math.random() * 0.8 - velocityY * 0.04,
        size: (15 + Math.random() * 25 + speed * 0.5) * sizeScale,
        life: 1,
        maxLife: 35 + Math.random() * 25,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.04,
        noiseOffsetX: Math.random() * 1000,
        noiseOffsetY: Math.random() * 1000,
        layer,
      })
    }

    const drawParticle = (p: SmokeParticle, alpha: number) => {
      const currentSize = p.size * (0.4 + (1 - p.life) * 2.2)
      const [cr, cg, cb] = config.coreColor
      const [er, eg, eb] = config.edgeColor

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)

      const cacheKey = `${Math.round(currentSize)}-${p.layer > 0.5 ? 1 : 0}`
      let gradient = gradientCacheRef.current.get(cacheKey)
      if (!gradient) {
        gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, currentSize)
        if (config.composite === 'lighter') {
          gradient.addColorStop(0, `rgba(${cr},${cg},${cb},${0.4 * config.glowIntensity})`)
          gradient.addColorStop(0.2, `rgba(${cr},${cg},${cb},${0.25 * config.glowIntensity})`)
          gradient.addColorStop(0.5, `rgba(${er},${eg},${eb},${0.12 * config.glowIntensity})`)
          gradient.addColorStop(0.8, `rgba(${er},${eg},${eb},${0.04})`)
          gradient.addColorStop(1, 'rgba(0,0,0,0)')
        } else {
          const intensity = p.layer > 0.5 ? 0.5 : 0.35
          gradient.addColorStop(0, `rgba(${cr},${cg},${cb},${intensity})`)
          gradient.addColorStop(0.3, `rgba(${cr},${cg},${cb},${intensity * 0.6})`)
          gradient.addColorStop(0.6, `rgba(${er},${eg},${eb},${intensity * 0.3})`)
          gradient.addColorStop(1, 'rgba(0,0,0,0)')
        }
        gradientCacheRef.current.set(cacheKey, gradient)
      }

      ctx.globalAlpha = alpha
      ctx.globalCompositeOperation = config.composite
      ctx.beginPath()
      ctx.ellipse(0, 0, currentSize, currentSize * (0.85 + p.layer * 0.3), 0, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      if (config.glowIntensity > 0.4) {
        const glowSize = currentSize * 1.6
        const glowGradient = ctx.createRadialGradient(0, 0, currentSize * 0.3, 0, 0, glowSize)
        glowGradient.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 0.15 * config.glowIntensity})`)
        glowGradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.arc(0, 0, glowSize, 0, Math.PI * 2)
        ctx.fillStyle = glowGradient
        ctx.fill()
      }

      ctx.restore()
    }

    const animate = () => {
      timeRef.current += 0.016

      ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio)

      let i = particles.length
      while (i--) {
        const p = particles[i]
        const [cx, cy] = curlNoise(p.x + p.noiseOffsetX, p.y + p.noiseOffsetY, timeRef.current)
        p.vx += cx * 0.3
        p.vy += cy * 0.3 - 0.015

        p.vx *= 0.97
        p.vy *= 0.98
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed
        p.life -= 1 / p.maxLife

        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }

        const fadeIn = Math.min(1, (1 - p.life) * 8)
        const fadeOut = p.life < 0.3 ? p.life / 0.3 : 1
        const alpha = fadeIn * fadeOut * (0.4 + p.layer * 0.25)

        drawParticle(p, alpha)
      }

      if (particles.length > 0) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        isAnimating = false
      }
    }

    const startAnimation = () => {
      if (!isAnimating) {
        isAnimating = true
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    const onMove = (e: MouseEvent) => {
      const velocityX = e.clientX - prevMouseRef.current.x
      const velocityY = e.clientY - prevMouseRef.current.y
      prevMouseRef.current = { x: e.clientX, y: e.clientY }
      mouseRef.current = { x: e.clientX, y: e.clientY }

      const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY)
      const baseCount = Math.min(4, Math.max(1, Math.floor(speed / 5)))
      const spawnCount = Math.max(1, Math.round(baseCount * vol))

      for (let i = 0; i < spawnCount; i++) {
        const t = i / spawnCount
        const interpX = e.clientX - velocityX * t * 0.5
        const interpY = e.clientY - velocityY * t * 0.5
        const offsetX = (Math.random() - 0.5) * 8
        const offsetY = (Math.random() - 0.5) * 5
        spawnSmoke(interpX + offsetX, interpY + offsetY, velocityX, velocityY)
      }
      startAnimation()
    }

    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(rafRef.current)
      particlesRef.current = []
      gradientCacheRef.current.clear()
      canvas.remove()
      canvasRef.current = null
    }
  }, [active, variant, volume, containerRef, customColor])
}
