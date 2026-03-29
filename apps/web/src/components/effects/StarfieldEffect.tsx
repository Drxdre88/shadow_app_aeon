'use client'

import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  size: number
  twinklePhase: number
  twinkleSpeed: number
  baseAlpha: number
}

interface ShootingStar {
  x: number
  y: number
  vx: number
  vy: number
  length: number
  life: number
  maxLife: number
}

export function StarfieldEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.2;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let stars: Star[] = []
    const shootingStars: ShootingStar[] = []
    let rafId: number
    let frame = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initStars()
    }

    const initStars = () => {
      stars = []
      const count = Math.floor((canvas.width * canvas.height) / 6000)
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 0.3 + Math.random() * 2,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.01 + Math.random() * 0.04,
          baseAlpha: 0.3 + Math.random() * 0.7,
        })
      }
    }

    const spawnShootingStar = () => {
      if (shootingStars.length >= 3) return
      const angle = -0.3 - Math.random() * 0.5
      const speed = 6 + Math.random() * 10
      shootingStars.push({
        x: Math.random() * canvas.width * 0.8 + canvas.width * 0.1,
        y: Math.random() * canvas.height * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * -speed,
        length: 30 + Math.random() * 60,
        life: 30 + Math.random() * 40,
        maxLife: 30 + Math.random() * 40,
      })
    }

    const drawNebulaGlow = () => {
      const cx = canvas.width * 0.7
      const cy = canvas.height * 0.3
      const r = Math.min(canvas.width, canvas.height) * 0.3

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, 'rgba(60,20,80,0.04)')
      grad.addColorStop(0.5, 'rgba(30,10,60,0.02)')
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const cx2 = canvas.width * 0.25
      const cy2 = canvas.height * 0.6
      const grad2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r * 0.7)
      grad2.addColorStop(0, 'rgba(20,40,80,0.03)')
      grad2.addColorStop(0.5, 'rgba(10,20,60,0.015)')
      grad2.addColorStop(1, 'transparent')
      ctx.fillStyle = grad2
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      drawNebulaGlow()

      for (const s of stars) {
        s.twinklePhase += s.twinkleSpeed
        const alpha = s.baseAlpha * (0.5 + Math.sin(s.twinklePhase) * 0.5)

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.shadowColor = 'rgba(200,220,255,0.8)'
        ctx.shadowBlur = s.size * 4

        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()

        if (s.size > 1.5) {
          ctx.globalAlpha = alpha * 0.3
          ctx.beginPath()
          ctx.moveTo(s.x - s.size * 3, s.y)
          ctx.lineTo(s.x + s.size * 3, s.y)
          ctx.moveTo(s.x, s.y - s.size * 3)
          ctx.lineTo(s.x, s.y + s.size * 3)
          ctx.strokeStyle = 'rgba(200,220,255,0.5)'
          ctx.lineWidth = 0.5
          ctx.stroke()
        }

        ctx.restore()
      }

      frame++
      if (frame % 120 === 0 && Math.random() > 0.4) spawnShootingStar()

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i]
        ss.x += ss.vx
        ss.y -= ss.vy
        ss.life--

        if (ss.life <= 0) { shootingStars.splice(i, 1); continue }

        const alpha = (ss.life / ss.maxLife) * 0.9
        const tailX = ss.x - (ss.vx / Math.abs(ss.vx)) * ss.length
        const tailY = ss.y + (ss.vy / Math.abs(ss.vy)) * ss.length

        ctx.save()
        ctx.globalAlpha = alpha
        const grad = ctx.createLinearGradient(ss.x, ss.y, tailX, tailY)
        grad.addColorStop(0, 'rgba(255,255,255,1)')
        grad.addColorStop(0.3, 'rgba(180,200,255,0.6)')
        grad.addColorStop(1, 'rgba(100,150,255,0)')
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.shadowColor = 'rgba(180,200,255,0.8)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.moveTo(ss.x, ss.y)
        ctx.lineTo(tailX, tailY)
        ctx.stroke()
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
