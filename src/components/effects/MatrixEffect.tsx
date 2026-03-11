'use client'

import { useEffect, useRef } from 'react'
import { useThemeStore } from '@/stores/themeStore'

export function MatrixEffect() {
  const { colors } = useThemeStore()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.12;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const FONT_SIZE = 14
    const CHARS = 'アァカサタナハマヤラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨロヲゴゾドボポヴッン0123456789ABCDEF'

    let columns: number[] = []
    let speeds: number[] = []
    let rafId: number

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      const count = Math.floor(canvas.width / FONT_SIZE)
      columns = Array.from({ length: count }, () => Math.floor(Math.random() * canvas.height / FONT_SIZE) * -1)
      speeds = Array.from({ length: count }, () => 0.3 + Math.random() * 0.9)
    }

    const drawScanlines = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.03)'
      for (let y = 0; y < canvas.height; y += 4) {
        ctx.fillRect(0, y, canvas.width, 1)
      }
    }

    const drawVignette = () => {
      const grad = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.2,
        canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.85
      )
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,0.3)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    let acc: number[] = []

    const draw = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.font = `${FONT_SIZE}px monospace`
      ctx.fillStyle = colors.glowColor

      if (acc.length !== columns.length) {
        acc = new Array(columns.length).fill(0)
      }

      for (let i = 0; i < columns.length; i++) {
        acc[i] = (acc[i] || 0) + speeds[i]
        if (acc[i] < 1) continue
        acc[i] -= 1

        const char = CHARS[Math.floor(Math.random() * CHARS.length)]
        ctx.fillText(char, i * FONT_SIZE, columns[i] * FONT_SIZE)
        if (columns[i] * FONT_SIZE > canvas.height && Math.random() > 0.975) {
          columns[i] = 0
        }
        columns[i]++
      }

      drawScanlines()
      drawVignette()

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
