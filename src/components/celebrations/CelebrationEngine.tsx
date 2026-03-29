'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { celebrationRegistry } from './registry'
import type { CelebrationContext } from './types'

interface CelebrationEvent {
  x: number
  y: number
}

type CelebrationListener = (event: CelebrationEvent) => void

const listeners = new Set<CelebrationListener>()

export function triggerCelebration(x: number, y: number) {
  listeners.forEach((fn) => fn({ x, y }))
}

export function CelebrationEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const activeRef = useRef<{ startTime: number; originX: number; originY: number } | null>(null)
  const celebrationStyle = useThemeStore((s) => s.celebrationStyle)
  const themeColor = useThemeStore((s) => s.colors.primary)
  const glowColor = useThemeStore((s) => s.colors.glowColor)

  const handleTrigger = useCallback((event: CelebrationEvent) => {
    if (celebrationStyle === 'none') return
    const animation = celebrationRegistry[celebrationStyle]
    if (!animation) return

    activeRef.current = {
      startTime: performance.now(),
      originX: event.x,
      originY: event.y,
    }

    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    canvas.style.display = 'block'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const animate = (now: number) => {
      const active = activeRef.current
      if (!active) {
        canvas.style.display = 'none'
        return
      }

      const elapsed = now - active.startTime
      const duration = animation.duration
      const progress = Math.min(elapsed / duration, 1)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const celebCtx: CelebrationContext = {
        ctx,
        originX: active.originX,
        originY: active.originY,
        width: canvas.width,
        height: canvas.height,
        elapsed,
        duration,
        progress,
        themeColor,
        glowColor,
      }

      animation.render(celebCtx)

      if (progress >= 1) {
        activeRef.current = null
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        canvas.style.display = 'none'
        return
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }, [celebrationStyle, themeColor, glowColor])

  useEffect(() => {
    listeners.add(handleTrigger)
    return () => {
      listeners.delete(handleTrigger)
      cancelAnimationFrame(rafRef.current)
    }
  }, [handleTrigger])

  if (celebrationStyle === 'none') return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[100]"
      style={{ display: 'none' }}
    />
  )
}
