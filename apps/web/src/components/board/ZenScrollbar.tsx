'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { thumbGeometry, scrollTopForThumbTop, pageScrollTarget, type ThumbGeometry } from './zenScroller'

interface ZenScrollbarProps {
  scrollRef: React.RefObject<HTMLDivElement | null>
  accentColor: string
  glowColor: string
  reduceMotion: boolean
  /** Bump when list content changes so geometry re-measures (card add/remove). */
  contentKey: number
}

/**
 * Finger-friendly vertical scroller pinned to the right of the Zen surface.
 * The hit area is a full 28px-wide strip while the visual stays slim; native
 * flick-scrolling on the list keeps working — this only mirrors and drives
 * the same scrollTop.
 */
export function ZenScrollbar({ scrollRef, accentColor, glowColor, reduceMotion, contentKey }: ZenScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  // pointerId is part of the drag identity: on touch, a second finger landing
  // on the thumb would otherwise overwrite the origin and make the scrollbar
  // jump using the wrong pointer's coordinates.
  const dragStart = useRef<{ pointerId: number; pointerY: number; thumbTop: number } | null>(null)
  const [geom, setGeom] = useState<ThumbGeometry>({ visible: false, thumbHeight: 0, thumbTop: 0 })
  const [dragging, setDragging] = useState(false)

  const update = useCallback(() => {
    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return
    setGeom(thumbGeometry(el.scrollTop, el.scrollHeight, el.clientHeight, track.clientHeight))
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    update()
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onScroll) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, update, contentKey])

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // First pointer down owns the drag until it lifts; extra fingers are inert.
    if (dragStart.current) return
    dragStart.current = { pointerId: e.pointerId, pointerY: e.clientY, thumbTop: geom.thumbTop }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    const el = scrollRef.current
    const track = trackRef.current
    if (!start || start.pointerId !== e.pointerId || !el || !track) return
    const nextTop = start.thumbTop + (e.clientY - start.pointerY)
    el.scrollTop = scrollTopForThumbTop(nextTop, el.scrollHeight, el.clientHeight, track.clientHeight, geom.thumbHeight)
  }

  const endThumbDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== e.pointerId) return
    dragStart.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return
    const clickY = e.clientY - track.getBoundingClientRect().top
    const direction: 1 | -1 = clickY < geom.thumbTop ? -1 : 1
    el.scrollTo({
      top: pageScrollTarget(el.scrollTop, el.clientHeight, el.scrollHeight, direction),
      // Explicit smooth bypasses the CSS reduce-motion kill-switch, so gate
      // it here instead.
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  return (
    <div
      ref={trackRef}
      data-zen-scrollbar
      aria-hidden="true"
      onPointerDown={onTrackPointerDown}
      className={cn(
        'absolute right-0 top-2 bottom-2 w-7 flex justify-center transition-opacity duration-200',
        geom.visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      style={{ touchAction: 'none' }}
    >
      <div className="w-1.5 h-full rounded-full bg-white/10 pointer-events-none" />
      <div
        data-zen-scrollbar-thumb
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={endThumbDrag}
        onPointerCancel={endThumbDrag}
        className="absolute left-0 w-full flex justify-center cursor-grab active:cursor-grabbing"
        style={{ top: geom.thumbTop, height: geom.thumbHeight, touchAction: 'none' }}
      >
        <div
          className={cn('h-full rounded-full transition-[width,opacity] duration-150', dragging ? 'w-2.5' : 'w-1.5')}
          style={{
            backgroundColor: accentColor,
            boxShadow: dragging ? `0 0 12px ${glowColor}` : `0 0 6px ${glowColor}`,
            opacity: dragging ? 1 : 0.7,
          }}
        />
      </div>
    </div>
  )
}
