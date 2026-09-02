'use client'

import { useSyncExternalStore } from 'react'
import { verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable'
import type { MeasuringConfiguration } from '@dnd-kit/core'
import { MAX_BOARD_SCALE, parseOwnTranslate, rectWithoutOwnTranslate, scaleDisplacement } from './pinchZoom'

// The board's SETTLED pinch scale, published by useBoardPinchZoom at gesture
// end (never per frame — the gesture itself stays React-free). Consumers that
// need the scale during a drag read it here; a pinch and a drag never overlap
// (the pinch hook is locked while a card is lifted), so "settled" is exact for
// the whole drag.

const ZOOM_ATTR = 'boardZoom'

let currentZoom = MAX_BOARD_SCALE
const listeners = new Set<() => void>()

export function publishBoardZoom(scale: number) {
  if (scale === currentZoom) return
  currentZoom = scale
  for (const l of listeners) l()
}

export function getBoardZoom(): number {
  return currentZoom
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getServerSnapshot = () => MAX_BOARD_SCALE

export function useBoardZoom(): number {
  return useSyncExternalStore(subscribe, getBoardZoom, getServerSnapshot)
}

/**
 * The live per-frame scale of the wrapper an element sits in, read off the
 * data attribute the pinch hook writes. Elements outside any scale wrapper
 * (the trash zone, Zen's portal) report 1.
 */
export function readBoardScaleFor(element: Element): number {
  const wrapper = element.closest<HTMLElement>('[data-board-scale]')
  const raw = wrapper?.dataset[ZOOM_ATTR]
  const parsed = raw ? parseFloat(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_BOARD_SCALE
}

/**
 * dnd-kit's transform-agnostic measure, corrected for a scaled ancestor: the
 * node's own translate (a sortable displacement) is subtracted in viewport
 * px, not layout px, so the droppable rects of displaced cards stay true and
 * `over` stops flickering between neighbours while zoomed out. At the normal
 * zoom the plain rect is returned without touching computed styles: this
 * runs for every droppable on every measuring pass, and a pinch never
 * overlaps a drag, so the settled zoom is exact for the whole drag.
 */
export function measureUnderBoardZoom(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
  if (getBoardZoom() === MAX_BOARD_SCALE) return rect
  const scale = readBoardScaleFor(node)
  const translate = parseOwnTranslate(getComputedStyle(node).transform)
  return rectWithoutOwnTranslate(rect, translate, scale)
}

export const boardMeasuring: MeasuringConfiguration = {
  draggable: { measure: measureUnderBoardZoom },
  droppable: { measure: measureUnderBoardZoom },
}

/**
 * verticalListSortingStrategy whose displacement is expressed in the layout
 * px of a wrapper scaled by `zoom`, so neighbours slide by exactly one card
 * on screen instead of one card × zoom.
 */
export function verticalStrategyForZoom(zoom: number): SortingStrategy {
  if (zoom === MAX_BOARD_SCALE) return verticalListSortingStrategy
  return (args) => {
    const t = verticalListSortingStrategy(args)
    return t ? scaleDisplacement(t, zoom) : t
  }
}
