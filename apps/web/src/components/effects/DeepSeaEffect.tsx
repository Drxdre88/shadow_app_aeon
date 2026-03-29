'use client'

import { useEffect, useRef } from 'react'

interface Bubble {
  x: number
  y: number
  size: number
  speed: number
  wobblePhase: number
  wobbleSpeed: number
  opacity: number
}

export function DeepSeaEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.15;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const MAX_BUBBLES = 30
    const bubbles: Bubble[] = []
    let rafId: number
    let time = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawnBubble = () => {
      if (bubbles.length >= MAX_BUBBLES) return
      bubbles.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 10,
        size: 2 + Math.random() * 8,
        speed: 0.3 + Math.random() * 1.2,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.03,
        opacity: 0.2 + Math.random() * 0.5,
      })
    }

    const drawCaustics = () => {
      time += 0.008
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      for (let i = 0; i < 6; i++) {
        const cx = canvas.width * (0.2 + Math.sin(time + i * 1.7) * 0.3)
        const cy = canvas.height * (0.3 + Math.cos(time * 0.7 + i * 2.3) * 0.2)
        const r = 80 + Math.sin(time * 1.3 + i) * 40

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        grad.addColorStop(0, `rgba(0,180,200,${0.04 + Math.sin(time + i) * 0.02})`)
        grad.addColorStop(0.5, `rgba(0,120,180,${0.02 + Math.sin(time * 0.8 + i) * 0.01})`)
        grad.addColorStop(1, 'transparent')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
      }

      const lineCount = 8
      for (let i = 0; i < lineCount; i++) {
        const startX = (canvas.width / lineCount) * i + Math.sin(time * 0.5 + i) * 50
        const endX = startX + Math.sin(time * 0.8 + i * 1.5) * 80
        const alpha = 0.015 + Math.sin(time + i * 0.9) * 0.01

        ctx.strokeStyle = `rgba(0,200,220,${alpha})`
        ctx.lineWidth = 15 + Math.sin(time + i) * 8
        ctx.beginPath()
        ctx.moveTo(startX, 0)

        for (let y = 0; y < canvas.height; y += 30) {
          const wx = startX + Math.sin(y * 0.01 + time + i) * 40
          ctx.lineTo(wx, y)
        }
        ctx.stroke()
      }

      ctx.restore()
    }

    const drawBubble = (b: Bubble) => {
      ctx.save()
      ctx.globalAlpha = b.opacity

      const grad = ctx.createRadialGradient(
        b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.1,
        b.x, b.y, b.size
      )
      grad.addColorStop(0, 'rgba(180,230,255,0.6)')
      grad.addColorStop(0.5, 'rgba(100,180,220,0.2)')
      grad.addColorStop(1, 'rgba(60,140,200,0)')

      ctx.fillStyle = grad
      ctx.shadowColor = 'rgba(100,200,255,0.4)'
      ctx.shadowBlur = b.size * 2
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(180,230,255,0.3)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.arc(b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.2, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      drawCaustics()

      if (Math.random() > 0.85) spawnBubble()

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        b.wobblePhase += b.wobbleSpeed
        b.x += Math.sin(b.wobblePhase) * 0.5
        b.y -= b.speed
        b.size *= 1.0005

        if (b.y < -20) { bubbles.splice(i, 1); continue }

        drawBubble(b)
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
