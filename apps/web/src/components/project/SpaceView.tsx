'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { hexToRgba } from '@/lib/utils/colors'
import type { ProjectWithStats } from './types'
import { generateStarfield, generateNebulas, layoutPlanets, PARALLAX, type PlanetOrb } from './spaceHelpers'
import { type EntityRefs, spawnEntities, renderEntities } from './spaceEntities'
import {
  generateDustClouds, generateAsteroidBelts, renderDustClouds,
  renderGravLensing, renderAsteroidBelts, renderHyperspace, type HyperspaceState,
} from './spaceEffects'

interface SpaceViewProps {
  projects: ProjectWithStats[]
}

export function SpaceView({ projects }: SpaceViewProps) {
  const router = useRouter()
  const { projectColors, glowIntensity, spacePlanetGlow, spaceOrbitSpeed } = useThemeStore()
  const mult = Math.max(glowIntensity / 75, 0.4)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 900, h: 600 })
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetOrb | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(true)
  const animRef = useRef(0)
  const autoZoom = Math.max(0.2, Math.min(0.8, 1.2 / Math.sqrt(Math.max(projects.length, 1))))
  const camRef = useRef({ x: 0, y: 0, zoom: autoZoom })
  const dragRef = useRef<{ dragging: boolean; didDrag: boolean; lastX: number; lastY: number }>({ dragging: false, didDrag: false, lastX: 0, lastY: 0 })
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const hyperspaceRef = useRef<HyperspaceState | null>(null)
  const routerRef = useRef(router)
  routerRef.current = router
  const entityRef = useRef<EntityRefs>({
    shootingStars: [], comets: [], fireballs: [], ufos: [], rockets: [],
    lastSpawn: { shootingStar: 0, comet: 0, fireball: 0, ufo: 0, rocket: 0 },
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: Math.max(height, 500) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stars = useMemo(() => generateStarfield(6500), [])
  const nebulas = useMemo(() => generateNebulas(), [])
  const dustClouds = useMemo(() => generateDustClouds(), [])
  const { planets, groups: planetGroups } = useMemo(
    () => layoutPlanets(projects, projectColors),
    [projects, projectColors],
  )
  const asteroidBelts = useMemo(
    () => generateAsteroidBelts(planetGroups),
    [planetGroups],
  )

  useEffect(() => {
    for (const p of planets) {
      if (!imgCache.current.has(p.planetSrc)) {
        const img = new Image()
        img.src = p.planetSrc
        imgCache.current.set(p.planetSrc, img)
      }
    }
  }, [planets])

  useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  const applyZoom = useCallback((factor: number) => {
    const cam = camRef.current
    cam.zoom = Math.max(0.15, Math.min(4, cam.zoom * factor))
  }, [])

  const resetView = useCallback(() => { camRef.current = { x: 0, y: 0, zoom: 1 } }, [])

  const worldToScreen = useCallback((wx: number, wy: number) => {
    const cam = camRef.current
    return { sx: (wx - cam.x) * cam.zoom + dims.w / 2, sy: (wy - cam.y) * cam.zoom + dims.h / 2 }
  }, [dims])

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = camRef.current
    return { wx: (sx - dims.w / 2) / cam.zoom + cam.x, wy: (sy - dims.h / 2) / cam.zoom + cam.y }
  }, [dims])

  const render = useCallback((time: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = dims
    const dpr = window.devicePixelRatio || 1
    const targetW = w * dpr, targetH = h * dpr
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW; canvas.height = targetH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cam = camRef.current
    const t = time * 0.001

    ctx.fillStyle = '#08080f'; ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.translate(w / 2 + cam.x * -0.1 * cam.zoom, h / 2 + cam.y * -0.1 * cam.zoom)
    ctx.rotate(-0.35)
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.8)
    bg.addColorStop(0, 'rgba(160, 120, 70, 0.06)')
    bg.addColorStop(0.25, 'rgba(140, 100, 60, 0.03)')
    bg.addColorStop(0.5, 'rgba(80, 60, 120, 0.02)')
    bg.addColorStop(1, 'transparent')
    ctx.fillStyle = bg; ctx.fillRect(-w, -h * 0.2, w * 2, h * 0.4)
    ctx.restore()

    renderDustClouds(ctx, dustClouds, t, cam, w, h)

    for (const neb of nebulas) {
      const np = PARALLAX[1]
      const nx = (neb.x - cam.x * np) * cam.zoom + w / 2
      const ny = (neb.y - cam.y * np) * cam.zoom + h / 2
      const nr = neb.rx * cam.zoom
      if (nx + nr < -100 || nx - nr > w + 100 || ny + nr < -100 || ny - nr > h + 100) continue
      ctx.save(); ctx.translate(nx, ny); ctx.rotate(neb.rotation)
      const ng = ctx.createRadialGradient(0, 0, 0, 0, 0, nr)
      ng.addColorStop(0, neb.color.replace('ALPHA', String(neb.opacity)))
      ng.addColorStop(0.5, neb.color.replace('ALPHA', String(neb.opacity * 0.4)))
      ng.addColorStop(1, 'transparent')
      ctx.fillStyle = ng; ctx.scale(1, neb.ry / neb.rx)
      ctx.beginPath(); ctx.arc(0, 0, nr, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    for (const star of stars) {
      const p = PARALLAX[star.layer]
      const sx = (star.x - cam.x * p) * cam.zoom + w / 2
      const sy = (star.y - cam.y * p) * cam.zoom + h / 2
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue
      const twinkle = 0.5 + 0.5 * Math.sin(t * star.twinkleSpeed + star.twinkleOffset)
      const dimCycle = star.isHero ? 0.15 + 0.85 * twinkle : star.isBright ? 0.1 + 0.9 * twinkle : 0.2 + 0.8 * twinkle
      const alpha = star.brightness * dimCycle
      const sz = star.size * cam.zoom
      const { colorR: cR, colorG: cG, colorB: cB } = star

      if (star.isHero && sz > 1.5) {
        renderGravLensing(ctx, sx, sy, sz, alpha, t, cam.x)
        const bloomR = sz * 14
        const b1 = ctx.createRadialGradient(sx, sy, 0, sx, sy, bloomR)
        b1.addColorStop(0, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.2})`)
        b1.addColorStop(0.2, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.08})`)
        b1.addColorStop(0.5, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.02})`)
        b1.addColorStop(1, 'transparent')
        ctx.fillStyle = b1; ctx.beginPath(); ctx.arc(sx, sy, bloomR, 0, Math.PI * 2); ctx.fill()

        const anamR = sz * 20 * dimCycle
        const aG = ctx.createLinearGradient(sx - anamR, sy, sx + anamR, sy)
        aG.addColorStop(0, 'transparent')
        aG.addColorStop(0.3, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.08})`)
        aG.addColorStop(0.5, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.15})`)
        aG.addColorStop(0.7, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.08})`)
        aG.addColorStop(1, 'transparent')
        ctx.fillStyle = aG; ctx.fillRect(sx - anamR, sy - sz * 0.6, anamR * 2, sz * 1.2)

        const sLen = sz * 12 * dimCycle, sA = alpha * 0.5
        ctx.strokeStyle = `rgba(${cR}, ${cG}, ${cB}, ${sA})`; ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.moveTo(sx - sLen, sy); ctx.lineTo(sx + sLen, sy)
        ctx.moveTo(sx, sy - sLen); ctx.lineTo(sx, sy + sLen); ctx.stroke()
        const dL = sLen * 0.7
        ctx.strokeStyle = `rgba(${cR}, ${cG}, ${cB}, ${sA * 0.6})`; ctx.lineWidth = 0.5; ctx.beginPath()
        ctx.moveTo(sx - dL, sy - dL); ctx.lineTo(sx + dL, sy + dL)
        ctx.moveTo(sx + dL, sy - dL); ctx.lineTo(sx - dL, sy + dL); ctx.stroke()

        const coreR = sz * 1.2
        const cg2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR)
        cg2.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        cg2.addColorStop(0.4, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.8})`)
        cg2.addColorStop(1, `rgba(${cR}, ${cG}, ${cB}, 0)`)
        ctx.fillStyle = cg2; ctx.beginPath(); ctx.arc(sx, sy, coreR, 0, Math.PI * 2); ctx.fill()

        const glareR = sz * 8
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, glareR)
        sg.addColorStop(0, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.4})`)
        sg.addColorStop(0.3, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.12})`)
        sg.addColorStop(1, 'transparent')
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, glareR, 0, Math.PI * 2); ctx.fill()
      } else if (star.isBright && sz > 1) {
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(sz, 0.3), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cR}, ${cG}, ${cB}, ${alpha})`; ctx.fill()
        const sLen = sz * 8 * dimCycle, sA = alpha * 0.4
        ctx.strokeStyle = `rgba(${cR}, ${cG}, ${cB}, ${sA})`; ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(sx - sLen, sy); ctx.lineTo(sx + sLen, sy)
        ctx.moveTo(sx, sy - sLen); ctx.lineTo(sx, sy + sLen); ctx.stroke()
        const dL = sLen * 0.5
        ctx.strokeStyle = `rgba(${cR}, ${cG}, ${cB}, ${sA * 0.5})`; ctx.beginPath()
        ctx.moveTo(sx - dL, sy - dL); ctx.lineTo(sx + dL, sy + dL)
        ctx.moveTo(sx + dL, sy - dL); ctx.lineTo(sx - dL, sy + dL); ctx.stroke()
        const gR = sz * 6, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, gR)
        sg.addColorStop(0, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.35})`)
        sg.addColorStop(0.4, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.1})`)
        sg.addColorStop(1, 'transparent')
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, gR, 0, Math.PI * 2); ctx.fill()
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(sz, 0.3), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cR}, ${cG}, ${cB}, ${alpha})`; ctx.fill()
        if (sz > 1.2) {
          const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 3.5)
          sg.addColorStop(0, `rgba(${cR}, ${cG}, ${cB}, ${alpha * 0.25})`); sg.addColorStop(1, 'transparent')
          ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, sz * 3.5, 0, Math.PI * 2); ctx.fill()
        }
      }
    }

    spawnEntities(entityRef.current, t, w, h, cam)
    renderEntities(ctx, entityRef.current, 1 / 60, t, cam, worldToScreen)

    const orbitMult = spaceOrbitSpeed * 0.08
    renderAsteroidBelts(ctx, asteroidBelts, t, cam, worldToScreen, orbitMult)

    for (const planet of planets) {
      let pwx = planet.wx, pwy = planet.wy
      if (orbitMult > 0) {
        const a = planet.orbitAngle + t * orbitMult
        pwx = planet.orbitCx + Math.cos(a) * planet.orbitDist
        pwy = planet.orbitCy + Math.sin(a) * planet.orbitDist
      }
      const { sx, sy } = worldToScreen(pwx, pwy)
      const r = planet.radius * cam.zoom
      if (sx + r * 4 < 0 || sx - r * 4 > w || sy + r * 4 < 0 || sy - r * 4 > h) continue

      if (spacePlanetGlow) {
        const glowR = r * 2.2 * mult
        const outerG = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, glowR)
        outerG.addColorStop(0, hexToRgba(planet.hex, 0.3 * mult))
        outerG.addColorStop(0.5, hexToRgba(planet.hex, 0.1 * mult))
        outerG.addColorStop(1, 'transparent')
        ctx.fillStyle = outerG; ctx.beginPath(); ctx.arc(sx, sy, glowR, 0, Math.PI * 2); ctx.fill()
      }

      ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
      const img = imgCache.current.get(planet.planetSrc)
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, sx - r, sy - r, r * 2, r * 2)
      } else {
        const fb = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 0, sx, sy, r)
        fb.addColorStop(0, hexToRgba(planet.hex, 0.9)); fb.addColorStop(1, hexToRgba(planet.hex, 0.4))
        ctx.fillStyle = fb; ctx.fill()
      }
      ctx.restore()

      if (spacePlanetGlow) {
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.strokeStyle = hexToRgba(planet.hex, 0.5 * mult); ctx.lineWidth = 2 * cam.zoom
        ctx.shadowColor = planet.hex; ctx.shadowBlur = 12 * mult * cam.zoom
        ctx.stroke(); ctx.shadowBlur = 0
      }

      if (planet.completionPct > 0 && planet.completionPct < 100) {
        ctx.beginPath()
        ctx.arc(sx, sy, r + 4 * cam.zoom, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * planet.completionPct / 100))
        ctx.strokeStyle = hexToRgba(planet.hex, 0.6); ctx.lineWidth = 2 * cam.zoom; ctx.stroke()
      }

      const fs = Math.max(10, 11 * cam.zoom)
      ctx.font = `600 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      ctx.shadowColor = planet.hex; ctx.shadowBlur = 8 * mult
      ctx.fillStyle = hexToRgba(planet.hex, 0.85)
      ctx.fillText(planet.name, sx, sy + r + 8 * cam.zoom); ctx.shadowBlur = 0
    }

    for (const [, gp] of planetGroups) {
      const { sx: gcx, sy: gcy } = worldToScreen(gp[0].orbitCx, gp[0].orbitCy)
      const gHexG = gp[0]?.hex || '#a855f7'
      const rr = parseInt(gHexG.slice(1, 3), 16), gg = parseInt(gHexG.slice(3, 5), 16), bb = parseInt(gHexG.slice(5, 7), 16)
      const nebulaR = (120 + gp.length * 60) * cam.zoom
      const nebPulse = 0.6 + 0.4 * Math.sin(t * 0.3 + gp[0].orbitCx * 0.01)
      const ng = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, nebulaR)
      ng.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${0.06 * nebPulse * mult})`)
      ng.addColorStop(0.3, `rgba(${rr}, ${gg}, ${bb}, ${0.03 * nebPulse * mult})`)
      ng.addColorStop(0.6, `rgba(${rr}, ${gg}, ${bb}, ${0.01 * nebPulse * mult})`)
      ng.addColorStop(1, 'transparent')
      ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(gcx, gcy, nebulaR, 0, Math.PI * 2); ctx.fill()
    }

    for (const [label, groupPlanets] of planetGroups) {
      const wcx = groupPlanets[0].orbitCx
      const wcy = groupPlanets[0].orbitCy
      const { sx: lcx, sy: lcy } = worldToScreen(wcx, wcy)

      const gHex = groupPlanets[0]?.hex || '#a855f7'
      const cr = parseInt(gHex.slice(1, 3), 16)
      const cg = parseInt(gHex.slice(3, 5), 16)
      const cb = parseInt(gHex.slice(5, 7), 16)

      const pulse = Math.sin(t * 0.8 + label.length * 1.3) * 0.5 + 0.5
      const tA = 0.03 + 0.92 * pulse
      const gA = 0.02 + 0.7 * pulse
      const gS = (4 + 18 * pulse) * mult * cam.zoom

      const fs = Math.max(13, 16 * cam.zoom)
      ctx.font = `700 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const lt = label.toUpperCase()
      ctx.shadowColor = `rgba(${cr}, ${cg}, ${cb}, ${gA})`; ctx.shadowBlur = gS
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${tA * 0.4})`; ctx.fillText(lt, lcx, lcy)
      ctx.shadowBlur = gS * 0.6
      ctx.fillStyle = `rgba(${Math.min(255, cr + 60)}, ${Math.min(255, cg + 60)}, ${Math.min(255, cb + 60)}, ${tA})`
      ctx.fillText(lt, lcx, lcy); ctx.shadowBlur = 0
    }

    if (hoveredPlanet) {
      let hpx = hoveredPlanet.wx, hpy = hoveredPlanet.wy
      if (orbitMult > 0) {
        const a = hoveredPlanet.orbitAngle + t * orbitMult
        hpx = hoveredPlanet.orbitCx + Math.cos(a) * hoveredPlanet.orbitDist
        hpy = hoveredPlanet.orbitCy + Math.sin(a) * hoveredPlanet.orbitDist
      }
      const { sx, sy } = worldToScreen(hpx, hpy)
      const r = hoveredPlanet.radius * cam.zoom
      const pw = 170, ph = 56, px = sx + r + 14, py = sy - ph / 2
      ctx.fillStyle = 'rgba(8, 8, 18, 0.9)'; ctx.strokeStyle = hexToRgba(hoveredPlanet.hex, 0.3); ctx.lineWidth = 1
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 8); ctx.fill(); ctx.stroke()
      ctx.font = '600 11px system-ui'; ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText(hoveredPlanet.name, px + 10, py + 8)
      ctx.font = '10px system-ui'; ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.fillText(`${hoveredPlanet.totalTasks} tasks  |  ${hoveredPlanet.completionPct}%`, px + 10, py + 24)
      const bx = px + 10, by = py + 42, bw = pw - 20
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; ctx.fillRect(bx, by, bw, 3)
      ctx.fillStyle = hoveredPlanet.hex; ctx.fillRect(bx, by, bw * hoveredPlanet.completionPct / 100, 3)
    }

    if (hyperspaceRef.current) {
      const result = renderHyperspace(ctx, hyperspaceRef.current, t, w, h)
      if (result === 'navigate') {
        hyperspaceRef.current.navigated = true
        routerRef.current.push(`/project/${hyperspaceRef.current.targetId}`)
      } else if (result === 'done') {
        hyperspaceRef.current = null
      }
    }

    animRef.current = requestAnimationFrame(render)
  }, [dims, stars, nebulas, dustClouds, asteroidBelts, planets, planetGroups, mult, hoveredPlanet, worldToScreen, spacePlanetGlow, spaceOrbitSpeed])

  useEffect(() => {
    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [render])

  const findPlanetAt = useCallback((mx: number, my: number): PlanetOrb | null => {
    const { wx, wy } = screenToWorld(mx, my)
    const oM = spaceOrbitSpeed * 0.08
    const now = performance.now() * 0.001
    for (let i = planets.length - 1; i >= 0; i--) {
      const p = planets[i]
      let pwx = p.wx, pwy = p.wy
      if (oM > 0) {
        const a = p.orbitAngle + now * oM
        pwx = p.orbitCx + Math.cos(a) * p.orbitDist
        pwy = p.orbitCy + Math.sin(a) * p.orbitDist
      }
      const dx = wx - pwx, dy = wy - pwy
      if (dx * dx + dy * dy <= (p.radius + 8) * (p.radius + 8)) return p
    }
    return null
  }, [planets, screenToWorld, spaceOrbitSpeed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = camRef.current
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const nz = Math.max(0.15, Math.min(4, cam.zoom * factor))
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const wxB = (mx - dims.w / 2) / cam.zoom + cam.x, wyB = (my - dims.h / 2) / cam.zoom + cam.y
      cam.zoom = nz; cam.x = wxB - (mx - dims.w / 2) / nz; cam.y = wyB - (my - dims.h / 2) / nz
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [dims])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, didDrag: false, lastX: e.clientX, lastY: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag.dragging) {
      const cam = camRef.current
      cam.x -= (e.clientX - drag.lastX) / cam.zoom; cam.y -= (e.clientY - drag.lastY) / cam.zoom
      drag.didDrag = true
      drag.lastX = e.clientX; drag.lastY = e.clientY
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const orb = findPlanetAt(e.clientX - rect.left, e.clientY - rect.top)
    setHoveredPlanet(orb)
    if (canvasRef.current) canvasRef.current.style.cursor = orb ? 'pointer' : 'grab'
  }, [findPlanetAt])

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.didDrag) return
    if (hyperspaceRef.current) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const planet = findPlanetAt(e.clientX - rect.left, e.clientY - rect.top)
    if (planet) {
      const oM = spaceOrbitSpeed * 0.08
      const now = performance.now() * 0.001
      let pwx = planet.wx, pwy = planet.wy
      if (oM > 0) {
        const a = planet.orbitAngle + now * oM
        pwx = planet.orbitCx + Math.cos(a) * planet.orbitDist
        pwy = planet.orbitCy + Math.sin(a) * planet.orbitDist
      }
      const { sx, sy } = worldToScreen(pwx, pwy)
      const randomHue = [280, 190, 340, 30, 160, 50, 260][Math.floor(Math.random() * 7)]
      hyperspaceRef.current = {
        active: true, startTime: now, navigated: false,
        targetId: planet.id, vanishX: sx, vanishY: sy, hue: randomHue,
      }
    }
  }, [findPlanetAt, worldToScreen, spaceOrbitSpeed])

  const btnCn = 'p-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors'

  return (
    <div ref={containerRef} className={isFullscreen ? 'fixed inset-0 z-50 bg-[#08080f]' : 'w-full h-[calc(100vh-80px)] min-h-[600px] rounded-xl overflow-hidden relative border border-white/[0.06]'}>
      <canvas
        ref={canvasRef}
        style={{ width: dims.w, height: dims.h, cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { handleMouseUp(); setHoveredPlanet(null) }}
        onClick={handleClick}
      />
      <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
        <button onClick={() => applyZoom(1.3)} className={btnCn}><ZoomIn className="w-4 h-4" /></button>
        <button onClick={() => applyZoom(0.7)} className={btnCn}><ZoomOut className="w-4 h-4" /></button>
        <button onClick={resetView} className="px-2 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10 text-[10px] text-white/50 hover:text-white hover:bg-white/10 transition-colors">1:1</button>
        <button onClick={() => setIsFullscreen(!isFullscreen)} className={btnCn}>
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
      <div className="absolute bottom-3 right-3 text-[10px] text-white/25 bg-black/40 px-2 py-1 rounded-md backdrop-blur-sm">
        Scroll to zoom | Drag to pan | Click planet to open{isFullscreen ? ' | Esc to exit' : ''}
      </div>
    </div>
  )
}
