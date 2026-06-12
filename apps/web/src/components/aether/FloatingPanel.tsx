'use client'

import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { motion, useDragControls } from 'framer-motion'

// A draggable (and optionally resizable) floating panel. Drag starts ONLY from
// the header grip — so the body stays clickable/scrollable. Resize uses a
// manual corner handle (reliable across browsers, unlike CSS `resize` under a
// framer transform). Used by the Aether Legend. (The Reader needs a two-column
// layout — detail rolling out left of the column — so it hand-rolls the same
// drag/resize pattern rather than wrapping this single-box primitive.)
interface Props {
  initial: Partial<Record<'top' | 'left' | 'right' | 'bottom', number>>
  width: number
  height?: number
  resizable?: boolean
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  header: ReactNode
  children: ReactNode
  zIndex?: number
  panelStyle?: CSSProperties
  constraintsRef?: RefObject<HTMLElement | null>
}

export function FloatingPanel({
  initial,
  width,
  height,
  resizable = false,
  minWidth = 200,
  minHeight = 160,
  maxWidth = 900,
  maxHeight = 1200,
  header,
  children,
  zIndex = 45,
  panelStyle,
  constraintsRef,
}: Props) {
  const controls = useDragControls()
  const [size, setSize] = useState<{ w: number; h: number | undefined }>({ w: width, h: height })
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    resizing.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h ?? 320 }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizing.current) return
    const dx = e.clientX - resizing.current.x
    const dy = e.clientY - resizing.current.y
    setSize({
      w: Math.min(maxWidth, Math.max(minWidth, resizing.current.w + dx)),
      h: Math.min(maxHeight, Math.max(minHeight, resizing.current.h + dy)),
    })
  }
  const onResizeUp = (e: React.PointerEvent) => {
    resizing.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  return (
    <motion.div
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={constraintsRef}
      dragElastic={0.03}
      style={{
        position: 'absolute',
        ...initial,
        width: size.w,
        height: size.h,
        zIndex,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...panelStyle,
      }}
    >
      <div onPointerDown={(e) => controls.start(e)} style={{ cursor: 'grab', flexShrink: 0 }}>
        {header}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {resizable && (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          title="Drag to resize"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            zIndex: 3,
            background: 'linear-gradient(135deg, transparent 45%, rgba(180,150,255,0.55) 45%, rgba(180,150,255,0.55) 60%, transparent 60%, transparent 72%, rgba(180,150,255,0.4) 72%)',
          }}
        />
      )}
    </motion.div>
  )
}
