'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d'
import type { GraphEdge, GraphNode } from '@/lib/data/memories'
import { cleanTitle, edgeColor, isAutoEdge, nodeHue, type ColorMode } from './nodeColor'
import { spawnEntities, renderEntities, type EntityRefs } from '../project/spaceEntities'

export type BackdropId = 'cortex' | 'aeon' | 'art'

export const BACKDROP_URLS: Record<BackdropId, string> = {
  cortex: '/cortex/cortex_2d.png',
  aeon: '/cortex/aeon.png',
  art: '/cortex/art.png',
}

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  colorMode?: ColorMode
  backdrop?: BackdropId
}

type SimNode = GraphNode & {
  x: number
  y: number
  vx: number
  vy: number
  _hex: string
  _radius: number
  _degree: number
  _hue: number
  _glow: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function Kairos2D({ nodes, edges, selectedId, onSelect, colorMode = 'realm', backdrop = 'cortex' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState({ w: 900, h: 600 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const cam = useRef({ x: 0, y: 0, zoom: 0.9 })
  const drag = useRef({ down: false, didMove: false, lx: 0, ly: 0 })
  const mouse = useRef({ sx: 0, sy: 0 })
  const animRef = useRef(0)
  const lastT = useRef(performance.now() / 1000)
  const mountedRef = useRef(true)
  // Selection state mirrored into refs so the render loop reads them without
  // restarting when the user selects / hovers a node.
  const selectedRef = useRef(selectedId)
  const hoveredRef = useRef(hoveredId)
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { hoveredRef.current = hoveredId }, [hoveredId])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const entities = useRef<EntityRefs>({
    shootingStars: [], comets: [], fireballs: [], ufos: [], rockets: [],
    lastSpawn: { shootingStar: 0, comet: 0, fireball: 0, ufo: 0, rocket: 0 },
  })

  const backdropImg = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    const img = new Image()
    img.src = BACKDROP_URLS[backdrop]
    img.onload = () => { if (mountedRef.current) backdropImg.current = img }
    backdropImg.current = null
    return () => { img.onload = null; img.onerror = null }
  }, [backdrop])

  // Sim nodes are independent of colorMode — colour is derived per-frame in
  // the render loop. This keeps the d3-force simulation reference stable
  // across colorMode toggles so the layout doesn't reset to seed positions.
  const simNodes = useMemo<SimNode[]>(() => {
    const now = Date.now()
    const degree = new Map<string, number>()
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    // Explicitly construct fresh sim nodes — d3-force mutates in place,
    // so spreading would carry x/y/vx/vy across view remounts and seed
    // the new simulation with broken positions.
    return nodes.map((n, i) => {
      const ageDays = (now - new Date(n.createdAt).getTime()) / DAY_MS
      const recency = Math.max(0.32, 1 - ageDays / 14)
      const ang = (i / Math.max(nodes.length, 1)) * Math.PI * 2
      const seedR = 200 + Math.random() * 100
      return {
        id: n.id,
        title: n.title,
        type: n.type,
        source: n.source,
        realmId: n.realmId,
        projectId: n.projectId,
        taskId: n.taskId,
        repo: n.repo,
        tags: n.tags,
        pinned: n.pinned,
        createdAt: n.createdAt,
        x: Math.cos(ang) * seedR,
        y: Math.sin(ang) * seedR,
        vx: 0,
        vy: 0,
        _hex: '#888888',
        _radius: n.pinned ? 14 : 8 + recency * 5,
        _degree: degree.get(n.id) ?? 0,
        _hue: 240,
        _glow: recency,
      }
    })
  }, [nodes, edges])
  const colorModeRef = useRef(colorMode)
  useEffect(() => { colorModeRef.current = colorMode }, [colorMode])

  const nodeById = useMemo(() => {
    const m = new Map<string, SimNode>()
    for (const n of simNodes) m.set(n.id, n)
    return m
  }, [simNodes])

  const simLinks = useMemo(() => edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target)), [edges, nodeById])

  const hubIds = useMemo(() => {
    const sorted = [...simNodes].sort((a, b) => b._degree - a._degree)
    return new Set(sorted.slice(0, Math.min(5, sorted.length)).map((n) => n.id))
  }, [simNodes])

  useEffect(() => {
    if (simNodes.length === 0) return
    const sim = forceSimulation(simNodes, 2)
      .force('charge', forceManyBody().strength(-180).distanceMax(600))
      .force('link', forceLink(simLinks).id((n: { id: string }) => n.id).distance(70).strength(0.35))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.025)
    return () => { sim.stop() }
  }, [simNodes, simLinks])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDims({ w: Math.max(width, 200), h: Math.max(height, 200) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w2s = useCallback(
    (wx: number, wy: number) => ({
      sx: (wx - cam.current.x) * cam.current.zoom + dims.w / 2,
      sy: (wy - cam.current.y) * cam.current.zoom + dims.h / 2,
    }),
    [dims.w, dims.h],
  )

  const s2w = useCallback(
    (sx: number, sy: number) => ({
      wx: (sx - dims.w / 2) / cam.current.zoom + cam.current.x,
      wy: (sy - dims.h / 2) / cam.current.zoom + cam.current.y,
    }),
    [dims.w, dims.h],
  )

  const hitTest = useCallback((sx: number, sy: number): string | null => {
    const { wx, wy } = s2w(sx, sy)
    let best: { id: string; d: number } | null = null
    for (const n of simNodes) {
      const dx = n.x - wx
      const dy = n.y - wy
      const d = Math.hypot(dx, dy)
      if (d < n._radius + 4 && (!best || d < best.d)) best = { id: n.id, d }
    }
    return best?.id ?? null
  }, [simNodes, s2w])

  // Main render loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tick = (timeMs: number) => {
      if (!mountedRef.current) return
      const tSec = timeMs / 1000
      const dt = Math.min(0.05, tSec - lastT.current)
      lastT.current = tSec

      ctx.fillStyle = '#03020a'
      ctx.fillRect(0, 0, dims.w, dims.h)

      // Backdrop with parallax: image covers the viewport, pans 0.18× camera.
      const img = backdropImg.current
      if (img && img.complete && img.naturalWidth > 0) {
        const px = -cam.current.x * 0.18
        const py = -cam.current.y * 0.18
        const scale = Math.max(dims.w / img.naturalWidth, dims.h / img.naturalHeight) * 1.4
        const iw = img.naturalWidth * scale
        const ih = img.naturalHeight * scale
        const cx = dims.w / 2 + px - iw / 2
        const cy = dims.h / 2 + py - ih / 2
        ctx.globalAlpha = 0.85
        ctx.drawImage(img, cx, cy, iw, ih)
        ctx.globalAlpha = 1
        ctx.fillStyle = 'rgba(3, 2, 10, 0.35)'
        ctx.fillRect(0, 0, dims.w, dims.h)
      }

      // Comets / UFOs / rockets / shooting stars / fireballs.
      spawnEntities(entities.current, tSec, dims.w, dims.h, cam.current)
      renderEntities(ctx, entities.current, dt, tSec, cam.current, w2s)

      // Edges — additive glow lines. Bumped visibility so neurons clearly
      // connect at the current zoom. Auto-edges (auto-day/auto-tag/auto-repo)
      // stay subtler than user-asserted typed edges.
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const e of simLinks) {
        const a = nodeById.get(e.source)
        const b = nodeById.get(e.target)
        if (!a || !b) continue
        const { sx: ax, sy: ay } = w2s(a.x, a.y)
        const { sx: bx, sy: by } = w2s(b.x, b.y)
        const col = edgeColor(e.type)
        ctx.strokeStyle = col
        const isAuto = isAutoEdge(e.type)
        ctx.globalAlpha = isAuto ? 0.38 : 0.78
        ctx.lineWidth = (isAuto ? 1.0 : 2.2) * Math.max(0.6, cam.current.zoom)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      ctx.restore()

      // Nodes — match the 3D shader: two-tone radial body (accent at rim,
      // primary tint mid-disc, super-bright overdriven core), wrapped in an
      // atmospheric halo that simulates bloom feed via stacked additive
      // gradients.
      for (const n of simNodes) {
        const { sx, sy } = w2s(n.x, n.y)
        const isSel = n.id === selectedRef.current
        const isHov = n.id === hoveredRef.current
        const r = n._radius * cam.current.zoom * (isSel ? 1.45 : isHov ? 1.2 : 1.0)
        // Colour computed per-frame from current colorMode (read via ref so
        // toggling Realm/Repo/Type/Source doesn't restart the simulation).
        const hue = nodeHue(n, colorModeRef.current)
        const accentHue = (hue + 30) % 360
        const lightness = 56 + 14 * n._glow

        // Outer halo — single soft additive gradient, dialed back from the
        // previous double-stack which was over-glowing the nodes.
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 3.2)
        halo.addColorStop(0, `hsla(${hue}, 95%, 70%, 0.32)`)
        halo.addColorStop(0.5, `hsla(${accentHue}, 90%, 60%, 0.14)`)
        halo.addColorStop(1, 'transparent')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(sx, sy, r * 3.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // Body — accent at the silhouette, primary tint mid, hot core.
        const body = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
        body.addColorStop(0,    `hsl(${hue}, 100%, 88%)`)
        body.addColorStop(0.4,  `hsl(${hue}, 92%, ${lightness}%)`)
        body.addColorStop(0.9,  `hsl(${accentHue}, 85%, 55%)`)
        body.addColorStop(1,    `hsl(${accentHue}, 75%, 45%)`)
        ctx.fillStyle = body
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()

        // Pinpoint core.
        ctx.fillStyle = `hsla(${hue}, 100%, 96%, 0.95)`
        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(1.4, r * 0.16), 0, Math.PI * 2)
        ctx.fill()

        // Pinned ring.
        if (n.pinned) {
          ctx.strokeStyle = `hsla(${hue}, 90%, 80%, 0.9)`
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.arc(sx, sy, r * 1.55, 0, Math.PI * 2)
          ctx.stroke()
        }

        // Selected outline.
        if (isSel) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2)
          ctx.stroke()
        }

        // Labels: selected always, hovered, top-5 hubs.
        const showLabel = isSel || isHov || hubIds.has(n.id)
        if (showLabel) {
          ctx.font = isSel ? '600 13px system-ui, sans-serif' : '500 11px system-ui, sans-serif'
          ctx.textAlign = 'center'
          const label = cleanTitle(n.title)
          const ty = sy - r - 10
          ctx.fillStyle = 'rgba(8,4,18,0.85)'
          const tw = ctx.measureText(label).width + 14
          ctx.fillRect(sx - tw / 2, ty - 14, tw, 18)
          ctx.fillStyle = isSel ? '#ffffff' : 'rgba(255,255,255,0.85)'
          ctx.fillText(label, sx, ty)
        }
      }

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [dims.w, dims.h, simNodes, simLinks, nodeById, hubIds, w2s])

  // Pointer interaction.
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    drag.current = { down: true, didMove: false, lx: sx, ly: sy }
    mouse.current = { sx, sy }
    canvasRef.current!.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    mouse.current = { sx, sy }
    if (drag.current.down) {
      const dx = sx - drag.current.lx
      const dy = sy - drag.current.ly
      if (Math.hypot(dx, dy) > 3) drag.current.didMove = true
      cam.current.x -= dx / cam.current.zoom
      cam.current.y -= dy / cam.current.zoom
      drag.current.lx = sx
      drag.current.ly = sy
    } else {
      const id = hitTest(sx, sy)
      if (id !== hoveredId) setHoveredId(id)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    canvasRef.current!.releasePointerCapture(e.pointerId)
    if (!drag.current.didMove) {
      const id = hitTest(sx, sy)
      onSelect(id)
    }
    drag.current.down = false
  }
  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * 0.0015)
    const next = Math.max(0.2, Math.min(3.5, cam.current.zoom * factor))
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { wx, wy } = s2w(sx, sy)
    cam.current.zoom = next
    cam.current.x = wx - (sx - dims.w / 2) / next
    cam.current.y = wy - (sy - dims.h / 2) / next
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        width={dims.w}
        height={dims.h}
        style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current.down ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  )
}
