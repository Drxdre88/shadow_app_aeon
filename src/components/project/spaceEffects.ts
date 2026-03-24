export interface DustCloud {
  x: number; y: number
  width: number; height: number
  rotation: number; opacity: number
  r: number; g: number; b: number
  driftSpeed: number; driftOffset: number
}

export interface AsteroidBelt {
  cx: number; cy: number
  particles: { angle: number; dist: number; size: number; speed: number; brightness: number }[]
}

export interface HyperspaceState {
  active: boolean
  startTime: number
  targetId: string
  vanishX: number; vanishY: number
  hue: number
  navigated: boolean
}

interface Camera { x: number; y: number; zoom: number }
type W2S = (wx: number, wy: number) => { sx: number; sy: number }

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export function generateDustClouds(): DustCloud[] {
  const rng = seededRng(137)
  const tints = [
    [120, 80, 50], [60, 50, 90], [80, 60, 100],
    [100, 70, 40], [50, 70, 100], [90, 50, 80],
  ]
  return Array.from({ length: 14 }, () => {
    const tint = tints[Math.floor(rng() * tints.length)]
    return {
      x: (rng() - 0.5) * 7000,
      y: (rng() - 0.5) * 7000,
      width: 600 + rng() * 1400,
      height: 35 + rng() * 100,
      rotation: rng() * Math.PI,
      opacity: 0.012 + rng() * 0.022,
      r: tint[0], g: tint[1], b: tint[2],
      driftSpeed: 0.015 + rng() * 0.04,
      driftOffset: rng() * Math.PI * 2,
    }
  })
}

export function generateAsteroidBelts(
  groups: Map<string, { orbitCx: number; orbitCy: number; orbitDist: number }[]>,
): AsteroidBelt[] {
  const rng = seededRng(256)
  const belts: AsteroidBelt[] = []
  for (const [, planets] of groups) {
    if (planets.length === 0) continue
    const cx = planets[0].orbitCx
    const cy = planets[0].orbitCy
    const maxDist = Math.max(...planets.map(p => p.orbitDist))
    const beltRadius = maxDist + 70
    const count = 50 + planets.length * 12
    const particles = Array.from({ length: count }, () => ({
      angle: rng() * Math.PI * 2,
      dist: beltRadius + (rng() - 0.5) * 35,
      size: 0.4 + rng() * 1.2,
      speed: 0.02 + rng() * 0.04,
      brightness: 0.25 + rng() * 0.5,
    }))
    belts.push({ cx, cy, particles })
  }
  return belts
}

export function renderDustClouds(
  ctx: CanvasRenderingContext2D,
  clouds: DustCloud[], t: number,
  cam: Camera, w: number, h: number,
) {
  const px = 0.15
  for (const cloud of clouds) {
    const drift = Math.sin(t * cloud.driftSpeed + cloud.driftOffset) * 40
    const cx = (cloud.x + drift - cam.x * px) * cam.zoom + w / 2
    const cy = (cloud.y - cam.y * px) * cam.zoom + h / 2
    const cw = cloud.width * cam.zoom
    const ch = cloud.height * cam.zoom
    if (cx + cw < -200 || cx - cw > w + 200 || cy + ch * 2 < -200 || cy - ch * 2 > h + 200) continue

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(cloud.rotation)

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, cw * 0.5)
    g.addColorStop(0, `rgba(${cloud.r}, ${cloud.g}, ${cloud.b}, ${cloud.opacity})`)
    g.addColorStop(0.25, `rgba(${cloud.r}, ${cloud.g}, ${cloud.b}, ${cloud.opacity * 0.75})`)
    g.addColorStop(0.55, `rgba(${cloud.r}, ${cloud.g}, ${cloud.b}, ${cloud.opacity * 0.3})`)
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.scale(1, ch / Math.max(cw, 1))
    ctx.beginPath()
    ctx.arc(0, 0, cw * 0.5, 0, Math.PI * 2)
    ctx.fill()

    const wisp = ctx.createRadialGradient(cw * 0.12, 0, 0, cw * 0.12, 0, cw * 0.35)
    wisp.addColorStop(0, `rgba(${cloud.r + 30}, ${cloud.g + 20}, ${cloud.b + 15}, ${cloud.opacity * 0.6})`)
    wisp.addColorStop(0.5, `rgba(${cloud.r}, ${cloud.g}, ${cloud.b}, ${cloud.opacity * 0.2})`)
    wisp.addColorStop(1, 'transparent')
    ctx.fillStyle = wisp
    ctx.beginPath()
    ctx.arc(cw * 0.12, 0, cw * 0.35, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }
}

export function renderGravLensing(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, sz: number,
  alpha: number, t: number, camX: number,
) {
  if (sz < 2.5) return

  const lensR = sz * 18
  const panShift = camX * 0.003

  const rings = [
    { r: 255, g: 70, b: 70, off: 0 },
    { r: 255, g: 170, b: 50, off: 0.15 },
    { r: 255, g: 255, b: 80, off: 0.3 },
    { r: 80, g: 255, b: 80, off: 0.45 },
    { r: 70, g: 160, b: 255, off: 0.6 },
    { r: 130, g: 70, b: 255, off: 0.75 },
  ]

  for (const ring of rings) {
    const rr = lensR * (0.65 + ring.off * 0.35)
    const pulse = 0.8 + 0.2 * Math.sin(t * 0.3 + ring.off * 2)
    const ra = alpha * 0.035 * (1 - ring.off * 0.25) * pulse
    const ox = (panShift + Math.sin(t * 0.15 + ring.off * 4)) * (ring.off - 0.3) * 2

    ctx.beginPath()
    ctx.arc(sx + ox, sy, rr, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${ring.r}, ${ring.g}, ${ring.b}, ${ra})`
    ctx.lineWidth = sz * 0.7 * (1 - ring.off * 0.4)
    ctx.stroke()
  }

  const hg = ctx.createRadialGradient(sx, sy, lensR * 0.55, sx, sy, lensR)
  hg.addColorStop(0, 'transparent')
  hg.addColorStop(0.6, `rgba(180, 200, 255, ${alpha * 0.012})`)
  hg.addColorStop(0.85, `rgba(180, 200, 255, ${alpha * 0.035})`)
  hg.addColorStop(1, 'transparent')
  ctx.fillStyle = hg
  ctx.beginPath()
  ctx.arc(sx, sy, lensR, 0, Math.PI * 2)
  ctx.fill()
}

export function renderAsteroidBelts(
  ctx: CanvasRenderingContext2D,
  belts: AsteroidBelt[], t: number,
  cam: Camera, w2s: W2S, orbitMult: number,
) {
  const speedFactor = orbitMult > 0 ? orbitMult : 0.02
  for (const belt of belts) {
    for (const p of belt.particles) {
      const a = p.angle + t * p.speed * speedFactor
      const wx = belt.cx + Math.cos(a) * p.dist
      const wy = belt.cy + Math.sin(a) * p.dist
      const { sx, sy } = w2s(wx, wy)
      const r = p.size * cam.zoom
      if (r < 0.15) continue
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(160, 155, 145, ${p.brightness * 0.55})`
      ctx.fill()
    }
  }
}

export function renderHyperspace(
  ctx: CanvasRenderingContext2D,
  state: HyperspaceState,
  t: number, w: number, h: number,
): 'animating' | 'navigate' | 'done' {
  const elapsed = t - state.startTime
  const streakDuration = 0.55
  const fadeDuration = 0.35
  const totalDuration = streakDuration + fadeDuration

  if (elapsed >= totalDuration) return 'done'
  if (elapsed >= streakDuration && !state.navigated) return 'navigate'

  const cx = state.vanishX
  const cy = state.vanishY
  const baseHue = state.hue

  if (elapsed < streakDuration) {
    const p = elapsed / streakDuration
    const ease = p * p

    ctx.fillStyle = `hsla(${baseHue}, 40%, 8%, ${ease * 0.3})`
    ctx.fillRect(0, 0, w, h)

    const streakCount = 100
    for (let i = 0; i < streakCount; i++) {
      const angle = (i / streakCount) * Math.PI * 2 + i * 0.618
      const baseLen = 15 + (i % 7) * 25
      const len = baseLen * (1 + ease * 18)
      const dist = 40 + (i % 5) * 35 + ease * 350

      const x1 = cx + Math.cos(angle) * dist
      const y1 = cy + Math.sin(angle) * dist
      const x2 = cx + Math.cos(angle) * (dist + len)
      const y2 = cy + Math.sin(angle) * (dist + len)

      const sa = (0.25 + (i % 3) * 0.15) * Math.min(1, p * 3)
      const hue = (baseHue + (i * 37) % 60 - 30 + 360) % 360
      const sat = 65 + (i % 4) * 8

      const g = ctx.createLinearGradient(x1, y1, x2, y2)
      g.addColorStop(0, `hsla(${hue}, ${sat}%, 75%, ${sa * 0.15})`)
      g.addColorStop(0.35, `hsla(${hue}, ${sat}%, 85%, ${sa * 0.9})`)
      g.addColorStop(1, `hsla(${hue}, ${sat}%, 70%, ${sa * 0.03})`)

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = g
      ctx.lineWidth = 0.8 + ease * 2.5
      ctx.stroke()
    }

    if (p > 0.5) {
      const fade = (p - 0.5) / 0.5
      ctx.fillStyle = `rgba(8, 8, 15, ${fade * fade})`
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    ctx.fillStyle = '#08080f'
    ctx.fillRect(0, 0, w, h)
  }

  return 'animating'
}
