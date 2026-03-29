'use client'

import { useEffect, useRef } from 'react'

interface FireParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  hue: number
}

export function InfernoEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.18;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const MAX = 80
    const particles: FireParticle[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawn = () => {
      if (particles.length >= MAX) return
      const maxLife = 60 + Math.random() * 100
      particles.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 5,
        vx: (Math.random() - 0.5) * 2,
        vy: -(1.5 + Math.random() * 3),
        size: 3 + Math.random() * 8,
        life: maxLife,
        maxLife,
        hue: 10 + Math.random() * 30,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const fireH = 120
      const fireGrad = ctx.createLinearGradient(0, canvas.height - fireH, 0, canvas.height)
      fireGrad.addColorStop(0, 'transparent')
      fireGrad.addColorStop(0.4, 'rgba(255,60,0,0.05)')
      fireGrad.addColorStop(0.8, 'rgba(255,40,0,0.12)')
      fireGrad.addColorStop(1, 'rgba(255,30,0,0.2)')
      ctx.fillStyle = fireGrad
      ctx.fillRect(0, canvas.height - fireH, canvas.width, fireH)

      if (Math.random() > 0.3) spawn()
      if (Math.random() > 0.6) spawn()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx + Math.sin(p.life * 0.08) * 0.5
        p.y += p.vy
        p.vy *= 0.995
        p.size *= 0.995
        p.life--

        if (p.life <= 0 || p.y < -20 || p.size < 0.3) {
          particles.splice(i, 1)
          continue
        }

        const t = p.life / p.maxLife
        const alpha = t * 0.9

        ctx.save()
        ctx.globalAlpha = alpha

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2)
        if (t > 0.6) {
          grad.addColorStop(0, `hsla(${p.hue + 10},100%,80%,1)`)
          grad.addColorStop(0.4, `hsla(${p.hue},100%,55%,0.8)`)
          grad.addColorStop(1, `hsla(${p.hue - 5},100%,30%,0)`)
        } else if (t > 0.3) {
          grad.addColorStop(0, `hsla(${p.hue},100%,55%,0.9)`)
          grad.addColorStop(0.5, `hsla(${p.hue - 5},90%,35%,0.5)`)
          grad.addColorStop(1, `hsla(0,0%,20%,0)`)
        } else {
          grad.addColorStop(0, `hsla(0,0%,40%,0.6)`)
          grad.addColorStop(0.5, `hsla(0,0%,25%,0.3)`)
          grad.addColorStop(1, `hsla(0,0%,10%,0)`)
        }

        ctx.shadowColor = `hsla(${p.hue},100%,50%,0.6)`
        ctx.shadowBlur = p.size * 3
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2)
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
