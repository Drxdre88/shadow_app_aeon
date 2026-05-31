'use client'

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

type CamState = { x: number; y: number; zoom: number }

type Props = {
  camRef: React.MutableRefObject<CamState>
  onDraggingChange?: (dragging: boolean) => void
}

// Minimum world-unit radius considered a "click" (not a drag) in scene space.
const DRAG_THRESHOLD_PX = 4

export function OrthoControls2D({ camRef, onDraggingChange }: Props) {
  const { camera, gl } = useThree()
  const drag = useRef({ active: false, didMove: false, lx: 0, ly: 0 })

  useEffect(() => {
    const canvas = gl.domElement

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      drag.current = { active: true, didMove: false, lx: e.clientX, ly: e.clientY }
      canvas.setPointerCapture(e.pointerId)
      onDraggingChange?.(true)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current.active) return
      const dx = e.clientX - drag.current.lx
      const dy = e.clientY - drag.current.ly
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.current.didMove = true

      // Pan: move the camera in the opposite direction of the drag so the world
      // content follows the pointer. Screen Y is inverted vs world Y in Three.js.
      const zoom = camRef.current.zoom
      camRef.current.x -= dx / zoom
      camRef.current.y += dy / zoom
      drag.current.lx = e.clientX
      drag.current.ly = e.clientY

      const cam = camera as THREE.OrthographicCamera
      cam.position.x = camRef.current.x
      cam.position.y = camRef.current.y
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!drag.current.active) return
      canvas.releasePointerCapture(e.pointerId)
      const wasDrag = drag.current.didMove
      drag.current.active = false
      // Defer the drag-clear by one microtask so R3F's onPointerMissed (which
      // fires synchronously inside the same pointer event) can still see the
      // dragging flag and suppress unwanted deselects.
      if (wasDrag) {
        Promise.resolve().then(() => onDraggingChange?.(false))
      } else {
        onDraggingChange?.(false)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      const next = Math.max(0.15, Math.min(4.0, camRef.current.zoom * factor))

      const cam = camera as THREE.OrthographicCamera
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left - rect.width / 2
      const py = -(e.clientY - rect.top - rect.height / 2)

      // Zoom into the pointer position: keep the world point under the pointer fixed.
      const worldX = camRef.current.x + px / camRef.current.zoom
      const worldY = camRef.current.y + py / camRef.current.zoom
      camRef.current.zoom = next
      camRef.current.x = worldX - px / next
      camRef.current.y = worldY - py / next

      cam.zoom = next
      cam.position.x = camRef.current.x
      cam.position.y = camRef.current.y
      cam.updateProjectionMatrix()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [camera, gl, camRef, onDraggingChange])

  return null
}
