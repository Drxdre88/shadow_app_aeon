'use client'

import { useEffect, useRef } from 'react'

interface Raindrop {
  x: number
  y: number
  length: number
  speed: number
  opacity: number
}

export function StormEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.2;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const MAX_DROPS = 200
    const drops: Raindrop[] = []
    let rafId: number
    let lightningTimer = 0
    let lightningAlpha = 0
    let lightningBolts: { x: number; segments: { x: number; y: number }[] }[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawnRain = () => {
      if (drops.length >= MAX_DROPS) return
      drops.push({
        x: Math.random() * (canvas.width + 200) - 100,
        y: -20,
        length: 12 + Math.random() * 25,
        speed: 8 + Math.random() * 12,
        opacity: 0.15 + Math.random() * 0.4,
      })
    }

    const createBolt = (startX: number) => {
      const segments: { x: number; y: number }[] = [{ x: startX, y: 0 }]
      let x = startX
      let y = 0
      const targetY = canvas.height * (0.4 + Math.random() * 0.4)

      while (y < targetY) {
        x += (Math.random() - 0.5) * 60
        y += 15 + Math.random() * 30
        segments.push({ x, y })
      }

      return { x: startX, segments }
    }

    const drawLightning = () => {
      for (const bolt of lightningBolts) {
        ctx.save()
        ctx.globalAlpha = lightningAlpha

        ctx.strokeStyle = 'rgba(180,200,255,0.9)'
        ctx.shadowColor = 'rgba(100,150,255,1)'
        ctx.shadowBlur = 25
        ctx.lineWidth = 3

        ctx.beginPath()
        ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y)
        for (let i = 1; i < bolt.segments.length; i++) {
          ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y)
        }
        ctx.stroke()

        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.shadowBlur = 5
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y)
        for (let i = 1; i < bolt.segments.length; i++) {
          ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y)
        }
        ctx.stroke()

        for (let i = 1; i < bolt.segments.length; i += 2) {
          if (Math.random() > 0.6) {
            const seg = bolt.segments[i]
            ctx.beginPath()
            ctx.moveTo(seg.x, seg.y)
            const bx = seg.x + (Math.random() - 0.5) * 40
            const by = seg.y + 10 + Math.random() * 20
            ctx.lineTo(bx, by)
            ctx.stroke()
          }
        }

        ctx.restore()
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let i = 0; i < 5; i++) spawnRain()

      const windAngle = -0.15
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]
        d.x += Math.sin(windAngle) * d.speed * 0.3
        d.y += d.speed

        if (d.y > canvas.height + 30) { drops.splice(i, 1); continue }

        ctx.save()
        ctx.globalAlpha = d.opacity
        ctx.strokeStyle = 'rgba(140,170,220,0.7)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x + Math.sin(windAngle) * d.length * 0.3, d.y - d.length)
        ctx.stroke()
        ctx.restore()
      }

      lightningTimer++
      if (lightningTimer > 180 + Math.random() * 300) {
        lightningTimer = 0
        lightningAlpha = 1
        lightningBolts = [createBolt(Math.random() * canvas.width)]
        if (Math.random() > 0.6) {
          lightningBolts.push(createBolt(Math.random() * canvas.width))
        }
      }

      if (lightningAlpha > 0) {
        ctx.fillStyle = `rgba(140,170,220,${lightningAlpha * 0.08})`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        drawLightning()
        lightningAlpha *= 0.92
        if (lightningAlpha < 0.01) {
          lightningAlpha = 0
          lightningBolts = []
        }
      }

      rafId = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      canvas.remove()
    }
  }, [])

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-[1]" />
}
