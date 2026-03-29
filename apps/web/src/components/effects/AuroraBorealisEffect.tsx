'use client'

import { useEffect, useRef } from 'react'

export function AuroraBorealisEffect() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.12;'
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId: number
    let time = 0

    const BANDS = 5
    const bandPhases = Array.from({ length: BANDS }, () => Math.random() * Math.PI * 2)
    const bandSpeeds = Array.from({ length: BANDS }, () => 0.003 + Math.random() * 0.006)
    const bandColors = [
      [0, 255, 120],
      [0, 200, 255],
      [120, 80, 255],
      [0, 255, 180],
      [80, 120, 255],
    ]

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      time++

      for (let b = 0; b < BANDS; b++) {
        bandPhases[b] += bandSpeeds[b]
        const [r, g, bl] = bandColors[b]
        const baseY = canvas.height * (0.08 + b * 0.07)
        const bandHeight = 40 + Math.sin(bandPhases[b] * 1.3) * 20

        ctx.save()
        ctx.globalCompositeOperation = 'lighter'

        for (let pass = 0; pass < 3; pass++) {
          const grad = ctx.createLinearGradient(0, baseY - bandHeight * 2, 0, baseY + bandHeight * 2)
          grad.addColorStop(0, 'transparent')
          grad.addColorStop(0.3, `rgba(${r},${g},${bl},${0.02 + Math.sin(bandPhases[b]) * 0.015})`)
          grad.addColorStop(0.5, `rgba(${r},${g},${bl},${0.05 + Math.sin(bandPhases[b] + pass) * 0.03})`)
          grad.addColorStop(0.7, `rgba(${r},${g},${bl},${0.02 + Math.sin(bandPhases[b] + 1) * 0.015})`)
          grad.addColorStop(1, 'transparent')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.moveTo(0, baseY - bandHeight * 2)

          for (let x = 0; x <= canvas.width; x += 20) {
            const wave1 = Math.sin(x * 0.003 + bandPhases[b] + pass * 0.5) * bandHeight
            const wave2 = Math.sin(x * 0.007 + time * 0.008 + b) * bandHeight * 0.4
            const wave3 = Math.sin(x * 0.001 + bandPhases[b] * 0.5) * bandHeight * 0.6
            const y = baseY + wave1 + wave2 + wave3
            ctx.lineTo(x, y)
          }

          ctx.lineTo(canvas.width, baseY + bandHeight * 2)
          ctx.lineTo(0, baseY + bandHeight * 2)
          ctx.closePath()
          ctx.fill()
        }

        ctx.restore()
      }

      const starCount = 40
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      for (let i = 0; i < starCount; i++) {
        const sx = ((i * 7919 + 13) % canvas.width)
        const sy = ((i * 6271 + 37) % (canvas.height * 0.5))
        const twinkle = 0.3 + Math.sin(time * 0.02 + i * 2.7) * 0.3
        ctx.globalAlpha = twinkle
        ctx.beginPath()
        ctx.arc(sx, sy, 0.8, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

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
