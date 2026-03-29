'use client'

import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  type: 'dust' | 'rock' | 'flare'
  rotation: number
  rotSpeed: number
  gray: number
}

interface Crater {
  x: number
  y: number
  radius: number
  depth: number
}

export function MercuryEffect() {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.15;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) { canvas.remove(); return }

    const MAX_PARTICLES = 50
    const MAX_CRATERS = 12
    const particles: Particle[] = []
    const craters: Crater[] = []
    let time = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      craters.length = 0
      for (let i = 0; i < MAX_CRATERS; i++) {
        craters.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 15 + Math.random() * 60,
          depth: 0.03 + Math.random() * 0.06,
        })
      }
    }

    const spawn = () => {
      if (particles.length >= MAX_PARTICLES) return
      const rand = Math.random()
      const isFlare = rand > 0.92
      const isRock = !isFlare && rand > 0.6
      const maxLife = isFlare ? 40 + Math.random() * 60 : 120 + Math.random() * 200
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: isFlare ? -(0.3 + Math.random() * 0.8) : (Math.random() - 0.5) * 0.15,
        size: isFlare ? 2 + Math.random() * 4 : isRock ? 1.5 + Math.random() * 3 : 0.5 + Math.random() * 2,
        life: maxLife,
        maxLife,
        type: isFlare ? 'flare' : isRock ? 'rock' : 'dust',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
        gray: isFlare ? 200 : 80 + Math.random() * 80,
      })
    }

    const drawCraters = () => {
      for (const c of craters) {
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius)
        grad.addColorStop(0, `rgba(40, 35, 30, ${c.depth})`)
        grad.addColorStop(0.5, `rgba(60, 55, 48, ${c.depth * 0.6})`)
        grad.addColorStop(0.8, `rgba(80, 72, 62, ${c.depth * 0.3})`)
        grad.addColorStop(1, 'transparent')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = `rgba(100, 90, 75, ${c.depth * 0.8})`
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.radius * 0.85, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const drawHeatShimmer = () => {
      const shimmerH = 200
      const grad = ctx.createLinearGradient(0, canvas.height - shimmerH, 0, canvas.height)
      grad.addColorStop(0, 'transparent')
      const wave = Math.sin(time * 0.015) * 0.02
      grad.addColorStop(0.3, `rgba(180, 120, 40, ${0.02 + wave})`)
      grad.addColorStop(0.6, `rgba(200, 140, 50, ${0.04 + wave})`)
      grad.addColorStop(1, `rgba(160, 100, 30, ${0.06 + wave})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, canvas.height - shimmerH, canvas.width, shimmerH)

      for (let i = 0; i < 3; i++) {
        const waveY = canvas.height - shimmerH + 40 + i * 50
        ctx.beginPath()
        ctx.strokeStyle = `rgba(200, 150, 60, ${0.03 + Math.sin(time * 0.02 + i) * 0.015})`
        ctx.lineWidth = 1.5
        for (let x = 0; x < canvas.width; x += 4) {
          const y = waveY + Math.sin(x * 0.008 + time * 0.03 + i * 2) * 8
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }

    const drawSunGlow = () => {
      const sunX = canvas.width * 0.85
      const sunY = canvas.height * 0.08
      const pulse = 1 + Math.sin(time * 0.01) * 0.15

      const outerGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 300 * pulse)
      outerGrad.addColorStop(0, 'rgba(255, 200, 80, 0.08)')
      outerGrad.addColorStop(0.3, 'rgba(255, 160, 40, 0.04)')
      outerGrad.addColorStop(0.6, 'rgba(200, 120, 20, 0.02)')
      outerGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = outerGrad
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const coreGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 40 * pulse)
      coreGrad.addColorStop(0, 'rgba(255, 240, 200, 0.2)')
      coreGrad.addColorStop(0.5, 'rgba(255, 200, 100, 0.1)')
      coreGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(sunX, sunY, 40 * pulse, 0, Math.PI * 2)
      ctx.fill()
    }

    const draw = () => {
      time++
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      drawCraters()
      drawSunGlow()
      drawHeatShimmer()

      if (Math.random() > 0.6) spawn()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx + Math.sin(time * 0.005 + p.rotation) * 0.1
        p.y += p.vy
        p.rotation += p.rotSpeed
        p.life--

        if (p.life <= 0 || p.y < -20 || p.y > canvas.height + 20) {
          particles.splice(i, 1)
          continue
        }

        const t = p.life / p.maxLife
        const alpha = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1

        ctx.save()
        ctx.globalAlpha = alpha * 0.8

        if (p.type === 'flare') {
          const flareGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
          flareGrad.addColorStop(0, `rgba(255, 220, 140, 0.9)`)
          flareGrad.addColorStop(0.3, `rgba(255, 180, 80, 0.6)`)
          flareGrad.addColorStop(0.6, `rgba(200, 120, 40, 0.3)`)
          flareGrad.addColorStop(1, 'transparent')
          ctx.shadowColor = 'rgba(255, 180, 60, 0.5)'
          ctx.shadowBlur = p.size * 4
          ctx.fillStyle = flareGrad
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
          ctx.fill()
        } else if (p.type === 'rock') {
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rotation)
          const g = p.gray
          ctx.fillStyle = `rgb(${g}, ${g - 8}, ${g - 15})`
          ctx.beginPath()
          ctx.moveTo(-p.size, -p.size * 0.6)
          ctx.lineTo(p.size * 0.8, -p.size * 0.4)
          ctx.lineTo(p.size, p.size * 0.5)
          ctx.lineTo(-p.size * 0.3, p.size * 0.7)
          ctx.closePath()
          ctx.fill()
        } else {
          const g = p.gray
          ctx.fillStyle = `rgba(${g}, ${g - 5}, ${g - 10}, 0.6)`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      canvas.remove()
    }
  }, [])

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-[1]" />
}
