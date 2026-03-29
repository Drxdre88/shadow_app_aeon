'use client'

import { useEffect, useRef } from 'react'
import { useThemeStore } from '@/stores/themeStore'

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
}

export function VulcanEffect() {
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

    const MAX_EMBERS = 35
    const embers: Ember[] = []
    let rafId: number

    const glowColor = colors.glowColor

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const spawnEmber = () => {
      if (embers.length >= MAX_EMBERS) return
      const maxLife = 80 + Math.random() * 80
      embers.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 4,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -(0.8 + Math.random() * 1.6),
        size: 1.5 + Math.random() * 3,
        life: maxLife,
        maxLife,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const shimmerH = 80
      const shimmer = ctx.createLinearGradient(0, canvas.height - shimmerH, 0, canvas.height)
      shimmer.addColorStop(0, 'transparent')
      shimmer.addColorStop(1, glowColor.replace(/[\d.]+\)$/, '0.18)'))
      ctx.fillStyle = shimmer
      ctx.fillRect(0, canvas.height - shimmerH, canvas.width, shimmerH)

      if (Math.random() > 0.55) spawnEmber()

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]
        e.x += e.vx + Math.sin(e.life * 0.1) * 0.3
        e.y += e.vy
        e.life--

        if (e.life <= 0 || e.y < -10) {
          embers.splice(i, 1)
          continue
        }

        const alpha = (e.life / e.maxLife) * 0.9
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.shadowColor = glowColor
        ctx.shadowBlur = e.size * 4
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2)
        ctx.fillStyle = glowColor
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
  }, [colors.glowColor])

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-[1]" />
}
