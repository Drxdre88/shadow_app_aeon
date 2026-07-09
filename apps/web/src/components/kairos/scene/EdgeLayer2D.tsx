'use client'

import { useEffect, useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { edgeColor, isAutoEdge } from '../nodeColor'
import type { SimNode2D, SimLink2D } from './PlanetCloud2D'

type Props = {
  links: SimLink2D[]
  nodeById: Map<string, SimNode2D>
}

export function EdgeLayer2D({ links, nodeById }: Props) {
  const lineRef = useRef<THREE.LineSegments>(null)

  // Pre-allocate buffers sized for the max number of edges.
  const maxEdges = Math.max(links.length, 1)
  const positionBuf = useMemo(() => new Float32Array(maxEdges * 6), [maxEdges])
  const colorBuf = useMemo(() => new Float32Array(maxEdges * 6), [maxEdges])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positionBuf, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(colorBuf, 3).setUsage(THREE.DynamicDrawUsage))
    return g
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxEdges])

  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 1.0,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const tmp = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const pos = positionBuf
    const col = colorBuf
    let count = 0

    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      // d3-force mutates source/target from string ID → node object after the first tick.
      const a = typeof link.source === 'string' ? nodeById.get(link.source) : (link.source as SimNode2D)
      const b = typeof link.target === 'string' ? nodeById.get(link.target) : (link.target as SimNode2D)
      if (!a || !b) continue

      const ghost = link.type === 'supersedes'
      const auto = isAutoEdge(link.type)
      tmp.set(edgeColor(link.type))

      // Ghost-thread fades along its length: near-invisible at the retired
      // belief (source) and brightening toward the belief that replaced it
      // (target), so the lineage literally lightens toward the present. Every
      // other edge is a flat alpha at both ends. AdditiveBlending bakes alpha
      // into the vertex colour, so per-endpoint alpha gives the gradient free.
      const alphaA = ghost ? 0.14 : auto ? 0.38 : 0.78
      const alphaB = ghost ? 0.55 : auto ? 0.38 : 0.78

      const base = count * 6
      pos[base]     = a.x ?? 0;  pos[base + 1] = a.y ?? 0;  pos[base + 2] = 0
      pos[base + 3] = b.x ?? 0;  pos[base + 4] = b.y ?? 0;  pos[base + 5] = 0
      col[base]     = tmp.r * alphaA;  col[base + 1] = tmp.g * alphaA;  col[base + 2] = tmp.b * alphaA
      col[base + 3] = tmp.r * alphaB;  col[base + 4] = tmp.g * alphaB;  col[base + 5] = tmp.b * alphaB
      count++
    }

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    geometry.setDrawRange(0, count * 2)
  })

  return (
    <lineSegments ref={lineRef} geometry={geometry} material={material} renderOrder={1} />
  )
}
