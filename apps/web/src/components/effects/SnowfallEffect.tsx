'use client'

import { useEffect, useRef } from 'react'

interface Snowflake {
  x: number
  y: number
  radius: number
  speed: number
  wind: number
  wobblePhase: number
  wobbleSpeed: number
  opacity: number
}

export function SnowfallEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.25;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const MAX = 120
    const flakes: Snowflake[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawn = () => {
      if (flakes.length >= MAX) return
      flakes.push({
        x: Math.random() * canvas.width,
        y: -10,
        radius: 1 + Math.random() * 3.5,
        speed: 0.3 + Math.random() * 1.5,
        wind: (Math.random() - 0.5) * 0.6,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.01 + Math.random() * 0.03,
        opacity: 0.3 + Math.random() * 0.7,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let i = 0; i < 3; i++) spawn()

      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i]
        f.wobblePhase += f.wobbleSpeed
        f.x += f.wind + Math.sin(f.wobblePhase) * 0.5
        f.y += f.speed

        if (f.y > canvas.height + 10) { flakes.splice(i, 1); continue }

        ctx.save()
        ctx.globalAlpha = f.opacity
        ctx.shadowColor = 'rgba(200,220,255,0.8)'
        ctx.shadowBlur = f.radius * 3

        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius)
        grad.addColorStop(0, 'rgba(255,255,255,1)')
        grad.addColorStop(0.5, 'rgba(200,220,255,0.6)')
        grad.addColorStop(1, 'rgba(180,200,240,0)')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
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
