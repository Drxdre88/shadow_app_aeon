'use client'

import { useEffect, useRef } from 'react'
import { useThemeStore } from '@/stores/themeStore'

interface Bat {
  x: number
  y: number
  vx: number
  vy: number
  wingPhase: number
  wingSpeed: number
  size: number
  alpha: number
}

interface Drip {
  x: number
  y: number
  vy: number
  length: number
  maxLength: number
  width: number
  wobblePhase: number
  wobbleSpeed: number
  dripping: boolean
  fallen: boolean
  thick: boolean
}

interface FogParticle {
  x: number
  y: number
  radius: number
  speedX: number
  alpha: number
  pulsePhase: number
  pulseSpeed: number
}

export function DraculaEffect() {
  const { colors } = useThemeStore()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.15;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bats: Bat[] = []
    const drips: Drip[] = []
    const fog: FogParticle[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initFog()
    }

    const initFog = () => {
      fog.length = 0
      for (let i = 0; i < 30; i++) {
        fog.push({
          x: Math.random() * canvas.width,
          y: canvas.height - 60 + Math.random() * 80,
          radius: 40 + Math.random() * 80,
          speedX: (Math.random() - 0.5) * 0.3,
          alpha: 0.02 + Math.random() * 0.03,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.008 + Math.random() * 0.012,
        })
      }
    }

    const spawnBat = () => {
      if (bats.length >= 8) return
      const fromLeft = Math.random() > 0.5
      const speed = 1.0 + Math.random() * 1.5
      bats.push({
        x: fromLeft ? -60 : canvas.width + 60,
        y: 40 + Math.random() * canvas.height * 0.4,
        vx: fromLeft ? speed : -speed,
        vy: (Math.random() - 0.5) * 0.6,
        wingPhase: Math.random() * Math.PI * 2,
        wingSpeed: 0.08 + Math.random() * 0.06,
        size: 25 + Math.random() * 35,
        alpha: 0.25 + Math.random() * 0.35,
      })
    }

    const spawnDrip = () => {
      if (drips.length >= 20) return
      const thick = Math.random() > 0.5
      drips.push({
        x: 20 + Math.random() * (canvas.width - 40),
        y: 0,
        vy: thick ? 0.6 + Math.random() * 1.0 : 1.5 + Math.random() * 2.5,
        length: 0,
        maxLength: thick ? 20 + Math.random() * 35 : 8 + Math.random() * 18,
        width: thick ? 2.5 + Math.random() * 2.0 : 1.2 + Math.random() * 1.5,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.03,
        dripping: true,
        fallen: false,
        thick,
      })
    }

    const drawBat = (b: Bat) => {
      const wing = Math.sin(b.wingPhase) * b.size
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.globalAlpha = b.alpha

      ctx.fillStyle = '#1a1a2e'
      ctx.shadowColor = 'rgba(80,0,120,0.4)'
      ctx.shadowBlur = 8

      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.bezierCurveTo(-b.size * 0.8, -wing, -b.size * 2.0, -wing * 0.5, -b.size * 2.5, wing * 0.2)
      ctx.bezierCurveTo(-b.size * 1.6, b.size * 0.1, -b.size * 0.4, b.size * 0.25, 0, 0)
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.bezierCurveTo(b.size * 0.8, -wing, b.size * 2.0, -wing * 0.5, b.size * 2.5, wing * 0.2)
      ctx.bezierCurveTo(b.size * 1.6, b.size * 0.1, b.size * 0.4, b.size * 0.25, 0, 0)
      ctx.fill()

      ctx.beginPath()
      ctx.ellipse(0, 0, b.size * 0.35, b.size * 0.45, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#2a1a3e'
      ctx.beginPath()
      ctx.moveTo(-b.size * 0.25, -b.size * 0.38)
      ctx.lineTo(-b.size * 0.12, -b.size * 0.55)
      ctx.lineTo(-b.size * 0.05, -b.size * 0.38)
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(b.size * 0.05, -b.size * 0.38)
      ctx.lineTo(b.size * 0.12, -b.size * 0.55)
      ctx.lineTo(b.size * 0.25, -b.size * 0.38)
      ctx.fill()

      ctx.fillStyle = '#ff5555'
      ctx.shadowColor = '#ff0000'
      ctx.shadowBlur = 4
      ctx.beginPath()
      ctx.arc(-b.size * 0.13, -b.size * 0.12, b.size * 0.06, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(b.size * 0.13, -b.size * 0.12, b.size * 0.06, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    const drawDrip = (d: Drip) => {
      const wobbleX = Math.sin(d.wobblePhase) * 3
      const topY = d.fallen ? d.y : 0
      const botY = d.fallen ? d.y + d.length : d.length
      const tipX = d.x + wobbleX

      const grad = ctx.createLinearGradient(d.x, topY, tipX, botY)
      grad.addColorStop(0, 'rgba(139,0,0,0)')
      grad.addColorStop(0.5, 'rgba(139,0,0,0.6)')
      grad.addColorStop(1, 'rgba(139,0,0,0.9)')

      ctx.save()
      ctx.globalAlpha = d.fallen ? Math.max(0, 0.9 - (d.y / canvas.height) * 0.6) : 0.85
      ctx.strokeStyle = grad
      ctx.shadowColor = '#cc0000'
      ctx.shadowBlur = 3
      ctx.lineWidth = d.width
      ctx.lineCap = 'round'

      const midX = d.x + wobbleX * 0.5
      const midY = (topY + botY) * 0.5

      ctx.beginPath()
      ctx.moveTo(d.x, topY)
      ctx.quadraticCurveTo(midX, midY, tipX, botY)
      ctx.stroke()

      const tipRadius = d.width * (1.4 + Math.sin(d.wobblePhase * 2) * 0.3)
      const tipGrad = ctx.createRadialGradient(tipX, botY, 0, tipX, botY, tipRadius * 2.5)
      tipGrad.addColorStop(0, 'rgba(200,0,0,0.8)')
      tipGrad.addColorStop(0.5, 'rgba(139,0,0,0.5)')
      tipGrad.addColorStop(1, 'rgba(80,0,0,0)')

      ctx.fillStyle = tipGrad
      ctx.beginPath()
      ctx.arc(tipX, botY, tipRadius * 2.5, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    const drawFog = () => {
      for (const p of fog) {
        p.pulsePhase += p.pulseSpeed
        const pulsedAlpha = p.alpha * (0.7 + Math.sin(p.pulsePhase) * 0.3)

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius)
        grad.addColorStop(0, `rgba(100,80,130,${pulsedAlpha})`)
        grad.addColorStop(0.5, `rgba(80,60,110,${pulsedAlpha * 0.5})`)
        grad.addColorStop(1, 'rgba(60,40,90,0)')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()

        p.x += p.speedX
        if (p.x < -p.radius) p.x = canvas.width + p.radius
        if (p.x > canvas.width + p.radius) p.x = -p.radius
      }
    }

    let frame = 0
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      drawFog()

      if (frame % 180 === 0) spawnBat()
      if (frame % 90 === 0) spawnDrip()
      frame++

      for (let i = bats.length - 1; i >= 0; i--) {
        const b = bats[i]
        b.x += b.vx
        b.y += b.vy + Math.sin(b.wingPhase * 0.5) * 0.4
        b.wingPhase += b.wingSpeed
        drawBat(b)
        if (b.x < -120 || b.x > canvas.width + 120) bats.splice(i, 1)
      }

      for (let i = drips.length - 1; i >= 0; i--) {
        const d = drips[i]
        d.wobblePhase += d.wobbleSpeed

        if (d.dripping && d.length < d.maxLength) {
          d.length += d.vy
        } else if (d.dripping) {
          d.dripping = false
          d.fallen = true
        }

        if (d.fallen) {
          d.y += d.vy * 1.5
          if (d.y > canvas.height + 40) { drips.splice(i, 1); continue }
        }

        drawDrip(d)
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
  }, [colors.glowColor])

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-[1]" />
}
