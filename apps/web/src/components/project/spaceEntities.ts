export interface ShootingStar {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; brightness: number; length: number
  hue: number; saturation: number
}

export interface Comet {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; headSize: number
  trail: Array<{ x: number; y: number; alpha: number }>
  hue: number
}

export interface Fireball {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; headSize: number
  trail: Array<{ x: number; y: number; alpha: number; size: number }>
  embers: Array<{ x: number; y: number; vx: number; vy: number; life: number }>
}

export interface Ufo {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; wobbleOffset: number
  wobbleFreq: number; blinkPhase: number
}

export interface MiniRocket {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; angle: number
  trail: Array<{ x: number; y: number; alpha: number }>
  hue: number
}

export interface CameraState { x: number; y: number; zoom: number }

type W2S = (wx: number, wy: number) => { sx: number; sy: number }

export function spawnShootingStar(w: number, h: number, cam: CameraState): ShootingStar {
  const angle = -0.2 - Math.random() * 1.0
  const speed = 700 + Math.random() * 1200
  const colorRoll = Math.random()
  const hue = colorRoll < 0.5 ? 0 : colorRoll < 0.7 ? 200 : colorRoll < 0.85 ? 30 : 280
  const saturation = colorRoll < 0.5 ? 0 : 60 + Math.random() * 30
  return {
    x: cam.x + (Math.random() - 0.3) * (w / cam.zoom),
    y: cam.y - (h / cam.zoom) * 0.5 - Math.random() * 300,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    life: 0, maxLife: 0.2 + Math.random() * 0.5,
    brightness: 0.85 + Math.random() * 0.15,
    length: 100 + Math.random() * 200,
    hue, saturation,
  }
}

export function spawnComet(w: number, h: number, cam: CameraState): Comet {
  const angle = -0.15 - Math.random() * 0.5
  const speed = 80 + Math.random() * 120
  const side = Math.random() > 0.5 ? -1 : 1
  return {
    x: cam.x + side * (w / cam.zoom) * 0.6,
    y: cam.y - (h / cam.zoom) * 0.4 + Math.random() * (h / cam.zoom) * 0.3,
    vx: Math.cos(angle) * speed * -side, vy: Math.sin(angle) * speed,
    life: 0, maxLife: 3 + Math.random() * 5,
    headSize: 2 + Math.random() * 3,
    trail: [], hue: 20 + Math.random() * 50,
  }
}

export function spawnFireball(w: number, h: number, cam: CameraState): Fireball {
  const angle = -0.1 - Math.random() * 0.4
  const speed = 50 + Math.random() * 80
  const side = Math.random() > 0.5 ? -1 : 1
  return {
    x: cam.x + side * (w / cam.zoom) * 0.55,
    y: cam.y - (h / cam.zoom) * 0.3 + Math.random() * (h / cam.zoom) * 0.2,
    vx: Math.cos(angle) * speed * -side, vy: Math.sin(angle) * speed,
    life: 0, maxLife: 5 + Math.random() * 6,
    headSize: 5 + Math.random() * 5,
    trail: [], embers: [],
  }
}

export function spawnUfo(w: number, h: number, cam: CameraState): Ufo {
  const side = Math.random() > 0.5 ? -1 : 1
  const speed = 100 + Math.random() * 150
  return {
    x: cam.x + side * (w / cam.zoom) * 0.6,
    y: cam.y + (Math.random() - 0.5) * (h / cam.zoom) * 0.6,
    vx: -side * speed, vy: (Math.random() - 0.5) * 30,
    life: 0, maxLife: 4 + Math.random() * 5,
    wobbleOffset: Math.random() * Math.PI * 2,
    wobbleFreq: 3 + Math.random() * 4,
    blinkPhase: Math.random() * Math.PI * 2,
  }
}

export function spawnRocket(w: number, h: number, cam: CameraState): MiniRocket {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2
  const speed = 150 + Math.random() * 200
  return {
    x: cam.x + (Math.random() - 0.5) * (w / cam.zoom) * 0.8,
    y: cam.y + (h / cam.zoom) * 0.5 + Math.random() * 100,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    life: 0, maxLife: 2.5 + Math.random() * 3,
    angle, trail: [], hue: Math.random() > 0.5 ? 200 : 30,
  }
}

export interface EntityRefs {
  shootingStars: ShootingStar[]
  comets: Comet[]
  fireballs: Fireball[]
  ufos: Ufo[]
  rockets: MiniRocket[]
  lastSpawn: { shootingStar: number; comet: number; fireball: number; ufo: number; rocket: number }
}

export function spawnEntities(refs: EntityRefs, t: number, w: number, h: number, cam: CameraState) {
  const ls = refs.lastSpawn
  if (t - ls.shootingStar > 0.25 + Math.random() * 0.8) {
    refs.shootingStars.push(spawnShootingStar(w, h, cam))
    if (Math.random() < 0.3) refs.shootingStars.push(spawnShootingStar(w, h, cam))
    ls.shootingStar = t
  }
  if (t - ls.comet > 5 + Math.random() * 10) {
    refs.comets.push(spawnComet(w, h, cam))
    ls.comet = t
  }
  if (t - ls.fireball > 12 + Math.random() * 20) {
    refs.fireballs.push(spawnFireball(w, h, cam))
    ls.fireball = t
  }
  if (t - ls.ufo > 20 + Math.random() * 40) {
    refs.ufos.push(spawnUfo(w, h, cam))
    ls.ufo = t
  }
  if (t - ls.rocket > 14 + Math.random() * 25) {
    refs.rockets.push(spawnRocket(w, h, cam))
    ls.rocket = t
  }
}

function fadeEnvelope(life: number, maxLife: number): number {
  const p = life / maxLife
  const fadeIn = Math.min(1, life * 3)
  const fadeOut = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1
  return fadeIn * fadeOut
}

export function renderEntities(
  ctx: CanvasRenderingContext2D, refs: EntityRefs,
  dt: number, t: number, cam: CameraState, w2s: W2S,
) {
  refs.shootingStars = refs.shootingStars.filter((s) => {
    s.life += dt
    if (s.life > s.maxLife) return false
    s.x += s.vx * dt; s.y += s.vy * dt
    const p = s.life / s.maxLife
    const a = s.brightness * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85)
    const { sx, sy } = w2s(s.x, s.y)
    const tx = sx - (s.vx * s.length * 0.001) * cam.zoom
    const ty = sy - (s.vy * s.length * 0.001) * cam.zoom
    const isWhite = s.saturation === 0

    const wide = ctx.createLinearGradient(sx, sy, tx, ty)
    if (isWhite) {
      wide.addColorStop(0, `rgba(200, 220, 255, ${a * 0.1})`)
    } else {
      wide.addColorStop(0, `hsla(${s.hue}, ${s.saturation}%, 70%, ${a * 0.12})`)
    }
    wide.addColorStop(1, 'transparent')
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty)
    ctx.strokeStyle = wide; ctx.lineWidth = 4 * cam.zoom; ctx.stroke()

    const g = ctx.createLinearGradient(sx, sy, tx, ty)
    if (isWhite) {
      g.addColorStop(0, `rgba(255, 255, 255, ${a})`)
      g.addColorStop(0.2, `rgba(200, 220, 255, ${a * 0.6})`)
    } else {
      g.addColorStop(0, `hsla(${s.hue}, ${s.saturation}%, 95%, ${a})`)
      g.addColorStop(0.2, `hsla(${s.hue}, ${s.saturation}%, 70%, ${a * 0.6})`)
    }
    g.addColorStop(1, 'transparent')
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty)
    ctx.strokeStyle = g; ctx.lineWidth = 1.8 * cam.zoom; ctx.stroke()

    const headR = 2 * cam.zoom
    const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, headR * 3)
    hg.addColorStop(0, `rgba(255, 255, 255, ${a})`)
    if (isWhite) {
      hg.addColorStop(0.5, `rgba(200, 220, 255, ${a * 0.3})`)
    } else {
      hg.addColorStop(0.5, `hsla(${s.hue}, ${s.saturation}%, 80%, ${a * 0.3})`)
    }
    hg.addColorStop(1, 'transparent')
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(sx, sy, headR * 3, 0, Math.PI * 2); ctx.fill()

    ctx.beginPath(); ctx.arc(sx, sy, headR * 0.5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`; ctx.fill()
    return true
  })

  refs.comets = refs.comets.filter((c) => {
    c.life += dt
    if (c.life > c.maxLife) return false
    c.x += c.vx * dt; c.y += c.vy * dt
    c.trail.unshift({ x: c.x, y: c.y, alpha: 1 })
    if (c.trail.length > 80) c.trail.length = 80
    for (let i = 1; i < c.trail.length; i++) c.trail[i].alpha *= 0.96
    const a = fadeEnvelope(c.life, c.maxLife)
    for (let i = c.trail.length - 1; i >= 1; i--) {
      const tp = c.trail[i]
      const { sx: tx, sy: ty } = w2s(tp.x, tp.y)
      ctx.beginPath(); ctx.arc(tx, ty, (1 + (i / c.trail.length) * 3) * cam.zoom, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${c.hue}, 80%, 70%, ${tp.alpha * a * 0.4})`; ctx.fill()
    }
    const { sx: hx, sy: hy } = w2s(c.x, c.y)
    const hr = c.headSize * cam.zoom
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 4)
    hg.addColorStop(0, `hsla(${c.hue}, 90%, 95%, ${0.8 * a})`)
    hg.addColorStop(0.3, `hsla(${c.hue}, 80%, 70%, ${0.3 * a})`)
    hg.addColorStop(1, 'transparent')
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, hr * 4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${c.hue}, 60%, 95%, ${a})`; ctx.fill()
    return true
  })

  refs.fireballs = refs.fireballs.filter((f) => {
    f.life += dt
    if (f.life > f.maxLife) return false
    f.x += f.vx * dt; f.y += f.vy * dt
    f.trail.unshift({ x: f.x, y: f.y, alpha: 1, size: f.headSize })
    if (f.trail.length > 120) f.trail.length = 120
    for (let i = 1; i < f.trail.length; i++) { f.trail[i].alpha *= 0.97; f.trail[i].size *= 0.995 }
    const emberCount = Math.random() < 0.6 ? (Math.random() < 0.3 ? 2 : 1) : 0
    for (let ei = 0; ei < emberCount; ei++) {
      f.embers.push({
        x: f.x, y: f.y,
        vx: f.vx * 0.3 + (Math.random() - 0.5) * 80,
        vy: f.vy * 0.3 + (Math.random() - 0.5) * 80,
        life: 0.5 + Math.random() * 1.0,
      })
    }
    f.embers = f.embers.filter((e) => {
      e.life -= dt; if (e.life <= 0) return false
      e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 15 * dt
      const { sx: ex, sy: ey } = w2s(e.x, e.y)
      ctx.beginPath(); ctx.arc(ex, ey, cam.zoom * (0.5 + e.life), 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, ${150 + Math.floor(e.life * 100)}, 50, ${e.life * 0.7})`; ctx.fill()
      return true
    })
    const a = fadeEnvelope(f.life, f.maxLife)
    for (let i = f.trail.length - 1; i >= 1; i--) {
      const tp = f.trail[i]
      const { sx: tx, sy: ty } = w2s(tp.x, tp.y)
      const ratio = i / f.trail.length
      const tr = tp.size * cam.zoom * (0.3 + ratio * 0.7)
      const hue = 20 + ratio * 30
      ctx.beginPath(); ctx.arc(tx, ty, tr, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${hue}, 90%, ${60 - ratio * 20}%, ${tp.alpha * a * 0.5})`; ctx.fill()
    }
    const { sx: hx, sy: hy } = w2s(f.x, f.y)
    const hr = f.headSize * cam.zoom
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr * 5)
    hg.addColorStop(0, `rgba(255, 255, 240, ${0.9 * a})`)
    hg.addColorStop(0.2, `rgba(255, 200, 80, ${0.6 * a})`)
    hg.addColorStop(0.5, `rgba(255, 100, 30, ${0.3 * a})`)
    hg.addColorStop(1, 'transparent')
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, hr * 5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 230, ${a})`; ctx.fill()
    return true
  })

  refs.ufos = refs.ufos.filter((u) => {
    u.life += dt
    if (u.life > u.maxLife) return false
    u.x += u.vx * dt
    u.y += u.vy * dt + Math.sin(t * u.wobbleFreq + u.wobbleOffset) * 0.8
    const a = fadeEnvelope(u.life, u.maxLife)
    const { sx, sy } = w2s(u.x, u.y)
    const r = 5 * cam.zoom

    const dg = ctx.createRadialGradient(sx, sy - r * 0.3, 0, sx, sy, r * 3)
    dg.addColorStop(0, `rgba(100, 220, 255, ${0.3 * a})`)
    dg.addColorStop(1, 'transparent')
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, Math.PI * 2); ctx.fill()

    ctx.beginPath()
    ctx.ellipse(sx, sy, r * 1.8, r * 0.5, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(160, 180, 200, ${0.7 * a})`; ctx.fill()
    ctx.strokeStyle = `rgba(200, 220, 240, ${0.4 * a})`; ctx.lineWidth = 0.5; ctx.stroke()

    ctx.beginPath()
    ctx.ellipse(sx, sy - r * 0.4, r * 0.8, r * 0.6, 0, 0, Math.PI * 2)
    const dome = ctx.createRadialGradient(sx, sy - r * 0.6, 0, sx, sy - r * 0.4, r * 0.8)
    dome.addColorStop(0, `rgba(180, 240, 255, ${0.5 * a})`)
    dome.addColorStop(1, `rgba(100, 180, 220, ${0.2 * a})`)
    ctx.fillStyle = dome; ctx.fill()

    const blink = Math.sin(t * 8 + u.blinkPhase) > 0
    ctx.beginPath(); ctx.arc(sx - r * 1.3, sy, 1.2 * cam.zoom, 0, Math.PI * 2)
    ctx.fillStyle = blink ? `rgba(255, 60, 60, ${0.8 * a})` : `rgba(255, 60, 60, ${0.2 * a})`; ctx.fill()
    ctx.beginPath(); ctx.arc(sx + r * 1.3, sy, 1.2 * cam.zoom, 0, Math.PI * 2)
    ctx.fillStyle = blink ? `rgba(60, 255, 60, ${0.2 * a})` : `rgba(60, 255, 60, ${0.8 * a})`; ctx.fill()
    return true
  })

  refs.rockets = refs.rockets.filter((rk) => {
    rk.life += dt
    if (rk.life > rk.maxLife) return false
    rk.x += rk.vx * dt; rk.y += rk.vy * dt
    rk.trail.unshift({ x: rk.x, y: rk.y, alpha: 1 })
    if (rk.trail.length > 40) rk.trail.length = 40
    for (let i = 1; i < rk.trail.length; i++) rk.trail[i].alpha *= 0.92
    const a = fadeEnvelope(rk.life, rk.maxLife)
    for (let i = rk.trail.length - 1; i >= 1; i--) {
      const tp = rk.trail[i]
      const { sx: tx, sy: ty } = w2s(tp.x, tp.y)
      const sparkle = 0.5 + 0.5 * Math.sin(t * 20 + i * 3)
      const tr = (0.8 + (i / rk.trail.length) * 2.5) * cam.zoom
      ctx.beginPath(); ctx.arc(tx, ty, tr, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${rk.hue}, 90%, ${50 + sparkle * 30}%, ${tp.alpha * a * 0.5})`; ctx.fill()
    }
    const { sx, sy } = w2s(rk.x, rk.y)
    const sz = 3 * cam.zoom
    ctx.save()
    ctx.translate(sx, sy); ctx.rotate(rk.angle + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, -sz * 1.5); ctx.lineTo(-sz * 0.5, sz * 0.5); ctx.lineTo(sz * 0.5, sz * 0.5); ctx.closePath()
    ctx.fillStyle = `rgba(220, 220, 230, ${0.9 * a})`; ctx.fill()
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * a})`; ctx.lineWidth = 0.5; ctx.stroke()
    ctx.restore()

    const eg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 3)
    eg.addColorStop(0, `hsla(${rk.hue}, 90%, 80%, ${0.6 * a})`)
    eg.addColorStop(0.5, `hsla(${rk.hue}, 80%, 50%, ${0.2 * a})`)
    eg.addColorStop(1, 'transparent')
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(sx, sy, sz * 3, 0, Math.PI * 2); ctx.fill()
    return true
  })
}
