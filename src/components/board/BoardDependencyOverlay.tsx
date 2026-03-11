'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, type AccentColor } from '@/lib/utils/colors'

interface CardPosition {
  x: number
  y: number
  width: number
  height: number
}

function resolveHex(color: string): string {
  const preset = colorConfig[color as AccentColor]
  if (preset) return preset.hex
  return color.startsWith('#') ? color : `#${color}`
}

export function BoardDependencyOverlay({ enabled }: { enabled: boolean }) {
  const dependencies = useBoardStore((s) => s.dependencies)
  const tasks = useBoardStore((s) => s.tasks)
  const { colors, depLineWidth, depLineGlow, depLineStyle } = useThemeStore()
  const [positions, setPositions] = useState<Map<string, CardPosition>>(new Map())
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const positionsRef = useRef<Map<string, CardPosition>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePositions = useCallback(() => {
    if (!enabled) return
    const newPositions = new Map<string, CardPosition>()

    for (const dep of dependencies) {
      for (const id of [dep.blockerTaskId, dep.blockedTaskId]) {
        if (newPositions.has(id)) continue
        const el = document.querySelector(`[data-task-id="${id}"]`)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            newPositions.set(id, {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            })
          }
        }
      }
    }

    positionsRef.current = newPositions
    setPositions(new Map(newPositions))
  }, [dependencies, enabled])

  useEffect(() => {
    if (!enabled) return

    requestAnimationFrame(() => updatePositions())

    const debouncedUpdate = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(updatePositions, 100)
    }

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updatePositions)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', debouncedUpdate)

    const interval = setInterval(updatePositions, 500)

    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', debouncedUpdate)
      cancelAnimationFrame(rafRef.current)
      if (timerRef.current) clearTimeout(timerRef.current)
      clearInterval(interval)
    }
  }, [enabled, updatePositions])

  const edgeData = useMemo(() => {
    return dependencies.map((dep) => {
      const sourceTask = tasks.find((t) => t.id === dep.blockerTaskId)
      const targetTask = tasks.find((t) => t.id === dep.blockedTaskId)
      const sourceHex = resolveHex(sourceTask?.color ?? 'purple')
      const targetHex = resolveHex(targetTask?.color ?? 'purple')
      const gradId = `dep-grad-${dep.blockerTaskId.slice(0, 8)}-${dep.blockedTaskId.slice(0, 8)}`
      return { dep, sourceHex, targetHex, gradId, sameColor: sourceHex === targetHex }
    })
  }, [dependencies, tasks])

  if (!enabled || dependencies.length === 0) return null

  const glowMult = depLineGlow / 60
  const haloWidth = depLineWidth * 3 * glowMult
  const blurStd = Math.max(1, 4 * glowMult)
  const haloBlurStd = Math.max(1, 6 * glowMult)
  const dashArray = depLineStyle === 'dashed' ? '8 4' : depLineStyle === 'dotted' ? '2 4' : undefined

  return (
    <svg
      ref={svgRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-[45]"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id="board-edge-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blurStd} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="board-halo-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={haloBlurStd} />
        </filter>
        {edgeData.map(({ gradId, sourceHex, targetHex, sameColor }) => {
          if (sameColor) return null
          return (
            <linearGradient key={gradId} id={gradId} gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={sourceHex} />
              <stop offset="100%" stopColor={targetHex} />
            </linearGradient>
          )
        })}
        {edgeData.map(({ dep, gradId, sourceHex, targetHex, sameColor }) => (
          <marker
            key={`arrow-${gradId}`}
            id={`arrow-${gradId}`}
            viewBox="0 0 10 8"
            refX="9"
            refY="4"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 4 L 0 8 z" fill={targetHex} />
          </marker>
        ))}
      </defs>

      <style>{`
        @keyframes dep-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.7; }
        }
      `}</style>

      {edgeData.map(({ dep, sourceHex, targetHex, gradId, sameColor }) => {
        const source = positions.get(dep.blockerTaskId)
        const target = positions.get(dep.blockedTaskId)
        if (!source || !target) return null

        const sx = source.x + source.width
        const sy = source.y + source.height / 2
        const tx = target.x
        const ty = target.y + target.height / 2

        const midX = (sx + tx) / 2
        const d = `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`

        const strokeColor = sameColor ? sourceHex : `url(#${gradId})`
        const haloColor = sourceHex

        return (
          <g key={`${dep.blockerTaskId}-${dep.blockedTaskId}`}>
            {depLineGlow > 0 && (
              <path
                d={d}
                fill="none"
                stroke={haloColor}
                strokeWidth={haloWidth}
                filter="url(#board-halo-blur)"
                style={{ animation: 'dep-pulse 2s ease-in-out infinite' }}
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={depLineWidth}
              strokeDasharray={dashArray}
              filter={depLineGlow > 0 ? 'url(#board-edge-glow)' : undefined}
              markerEnd={`url(#arrow-${gradId})`}
            />
          </g>
        )
      })}
    </svg>
  )
}
