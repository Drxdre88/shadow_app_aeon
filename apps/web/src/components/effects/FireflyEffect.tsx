'use client'

import { useEffect, useRef } from 'react'

interface Firefly {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  pulsePhase: number
  pulseSpeed: number
  hue: number
  maxAlpha: number
}

export function FireflyEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.2;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let flies: Firefly[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initFlies()
    }

    const initFlies = () => {
      flies = []
      const count = 40
      for (let i = 0; i < count; i++) {
        flies.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.4,
          size: 2 + Math.random() * 3,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.02 + Math.random() * 0.04,
          hue: 50 + Math.random() * 120,
          maxAlpha: 0.4 + Math.random() * 0.6,
        })
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const f of flies) {
        f.pulsePhase += f.pulseSpeed
        const alpha = f.maxAlpha * (0.2 + Math.pow(Math.sin(f.pulsePhase) * 0.5 + 0.5, 2) * 0.8)

        f.vx += (Math.random() - 0.5) * 0.08
        f.vy += (Math.random() - 0.5) * 0.06
        f.vx *= 0.98
        f.vy *= 0.98
        f.x += f.vx
        f.y += f.vy

        if (f.x < -20) f.x = canvas.width + 20
        if (f.x > canvas.width + 20) f.x = -20
        if (f.y < -20) f.y = canvas.height + 20
        if (f.y > canvas.height + 20) f.y = -20

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.globalCompositeOperation = 'lighter'

        const outerGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 8)
        outerGrad.addColorStop(0, `hsla(${f.hue},100%,70%,0.3)`)
        outerGrad.addColorStop(0.3, `hsla(${f.hue},80%,50%,0.1)`)
        outerGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = outerGrad
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.size * 8, 0, Math.PI * 2)
        ctx.fill()

        const innerGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size)
        innerGrad.addColorStop(0, `hsla(${f.hue},100%,90%,1)`)
        innerGrad.addColorStop(0.5, `hsla(${f.hue},100%,65%,0.7)`)
        innerGrad.addColorStop(1, `hsla(${f.hue},80%,40%,0)`)
        ctx.fillStyle = innerGrad
        ctx.shadowColor = `hsla(${f.hue},100%,60%,0.8)`
        ctx.shadowBlur = f.size * 6
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2)
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
