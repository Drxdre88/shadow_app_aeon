'use client'

import { useEffect, useRef } from 'react'

interface Petal {
  x: number
  y: number
  size: number
  rotation: number
  rotSpeed: number
  speed: number
  drift: number
  driftPhase: number
  driftSpeed: number
  opacity: number
}

export function SakuraEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.2;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const MAX = 60
    const petals: Petal[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawn = () => {
      if (petals.length >= MAX) return
      petals.push({
        x: Math.random() * (canvas.width + 100) - 50,
        y: -20,
        size: 4 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.04,
        speed: 0.5 + Math.random() * 1.5,
        drift: (Math.random() - 0.3) * 0.8,
        driftPhase: Math.random() * Math.PI * 2,
        driftSpeed: 0.01 + Math.random() * 0.02,
        opacity: 0.4 + Math.random() * 0.6,
      })
    }

    const drawPetal = (p: Petal) => {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = p.opacity
      ctx.shadowColor = 'rgba(255,180,200,0.5)'
      ctx.shadowBlur = 6

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size)
      grad.addColorStop(0, 'rgba(255,200,210,0.9)')
      grad.addColorStop(0.5, 'rgba(255,160,180,0.7)')
      grad.addColorStop(1, 'rgba(255,120,150,0)')

      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = 'rgba(255,230,235,0.4)'
      ctx.beginPath()
      ctx.ellipse(-p.size * 0.2, -p.size * 0.1, p.size * 0.3, p.size * 0.15, -0.3, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (Math.random() > 0.7) spawn()

      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i]
        p.driftPhase += p.driftSpeed
        p.x += p.drift + Math.sin(p.driftPhase) * 0.8
        p.y += p.speed
        p.rotation += p.rotSpeed

        if (p.y > canvas.height + 20) { petals.splice(i, 1); continue }

        drawPetal(p)
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
