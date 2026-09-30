'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneNode } from '../scene/PlanetCloud'
import type { ColorMode } from '../nodeColor'
import {
  RING_PARTICLES,
  SHELL_SCALE,
  writeNodeColors,
  writeScaleTranslate,
  type GalaxyBuffers,
} from './buffers'
import { createOrbMaterial, createRingMaterial, createShellMaterial, RING_TILT } from './materials'

type Props = {
  nodes: SceneNode[]
  buffers: GalaxyBuffers
  colorMode: ColorMode
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

type Built = {
  orb: THREE.InstancedMesh
  shell: THREE.InstancedMesh
  ring: THREE.InstancedMesh | null
  tint: THREE.InstancedBufferAttribute
  accent: THREE.InstancedBufferAttribute
  scales: Float32Array
  ringLast: Float32Array
}

// Selection / hover grow, same easing as the old per-planet groups.
const EASE = 0.18
const SELECT_SCALE = 1.55
const HOVER_SCALE = 1.25

// All memory orbs as two InstancedMeshes (body + additive shell) plus one
// batch for pinned-ring debris. Picking is analytic ray–sphere per instance
// (radius × current scale × shell factor), returning instanceId to r3f.
export function GalaxyOrbs({ nodes, buffers, colorMode, selectedId, hoveredId, onSelect, onHover }: Props) {
  const time = useMemo(() => ({ value: 0 }), [])
  const mats = useMemo(
    () => ({ orb: createOrbMaterial(), shell: createShellMaterial(), ring: createRingMaterial(time) }),
    [time],
  )
  useEffect(() => () => {
    mats.orb.dispose()
    mats.shell.dispose()
    mats.ring.dispose()
  }, [mats])

  const built = useMemo<Built>(() => {
    const n = buffers.nodeCount
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    const accent = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    const orbGeo = new THREE.SphereGeometry(1, 48, 48)
    const shellGeo = new THREE.SphereGeometry(1, 32, 32)
    orbGeo.setAttribute('aAccent', accent)
    shellGeo.setAttribute('aAccent', accent)

    const orb = new THREE.InstancedMesh(orbGeo, mats.orb, n)
    const shell = new THREE.InstancedMesh(shellGeo, mats.shell, n)
    const scales = new Float32Array(n).fill(1)
    for (const m of [orb, shell]) {
      m.instanceColor = tint
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.frustumCulled = false // instances move every frame; a cached bound would cull/miss
    }
    shell.raycast = () => {}

    const sphere = new THREE.Sphere()
    const hit = new THREE.Vector3()
    orb.raycast = (raycaster, intersects) => {
      const ray = raycaster.ray
      for (let i = 0; i < n; i++) {
        const node = nodes[i]
        sphere.center.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
        sphere.radius = buffers.radii[i] * scales[i] * SHELL_SCALE
        if (!ray.intersectSphere(sphere, hit)) continue
        const distance = ray.origin.distanceTo(hit)
        if (distance < raycaster.near || distance > raycaster.far) continue
        intersects.push({ distance, point: hit.clone(), object: orb, instanceId: i })
      }
    }

    let ring: THREE.InstancedMesh | null = null
    const rb = buffers.rings
    if (rb.count > 0) {
      const ringGeo = new THREE.IcosahedronGeometry(1, 0)
      ringGeo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(rb.orbit, 4))
      ringGeo.setAttribute('aPScale', new THREE.InstancedBufferAttribute(rb.scale, 1))
      ring = new THREE.InstancedMesh(ringGeo, mats.ring, rb.count)
      ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      ring.frustumCulled = false
      ring.raycast = () => {}
    }
    // last written x,y,z,scale per ring owner — rings rewrite only when their planet moved.
    const ringLast = new Float32Array(rb.ringCount * 4).fill(Number.NaN)
    return { orb, shell, ring, tint, accent, scales, ringLast }
  }, [buffers, nodes, mats])

  useEffect(() => () => {
    built.orb.geometry.dispose()
    built.shell.geometry.dispose()
    built.orb.dispose()
    built.shell.dispose()
    if (built.ring) {
      built.ring.geometry.dispose()
      built.ring.dispose()
    }
  }, [built])

  // Colour is derived from colorMode without touching the simulation data.
  useEffect(() => applyColors(built, nodes, colorMode), [built, nodes, colorMode])

  const hoverIdx = useRef<number | null>(null)

  useFrame((_, delta) => {
    const sel = selectedId ? buffers.index.get(selectedId) ?? -1 : -1
    const hov = hoveredId ? buffers.index.get(hoveredId) ?? -1 : -1
    updateFrame(built, buffers, nodes, sel, hov, delta, time)
  })

  const idOf = (e: ThreeEvent<PointerEvent>) => (e.instanceId === undefined ? null : nodes[e.instanceId]?.id ?? null)

  return (
    <>
      <primitive
        object={built.orb}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          const id = idOf(e)
          if (id) onSelect(id)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          hoverIdx.current = e.instanceId ?? null
          onHover(idOf(e))
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          // r3f fires out/over per instance; only clear if this instance still owns hover.
          if (hoverIdx.current === (e.instanceId ?? null)) {
            hoverIdx.current = null
            onHover(null)
          }
        }}
      />
      <primitive object={built.shell} />
      {built.ring && <primitive object={built.ring} />}
    </>
  )
}

function applyColors(built: Built, nodes: SceneNode[], mode: ColorMode): void {
  writeNodeColors(nodes, mode, built.tint.array as Float32Array, built.accent.array as Float32Array)
  built.tint.needsUpdate = true
  built.accent.needsUpdate = true
}

const _ringMatrix = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()

// Per-frame: ease selection/hover scale, write orb + shell matrices from the
// simulated positions, and re-pose ring batches only for planets that moved.
function updateFrame(
  built: Built,
  buffers: GalaxyBuffers,
  nodes: SceneNode[],
  sel: number,
  hov: number,
  delta: number,
  time: { value: number },
): void {
  time.value += delta
  const { orb, shell, ring, scales, ringLast } = built
  const om = orb.instanceMatrix.array as Float32Array
  const sm = shell.instanceMatrix.array as Float32Array
  for (let i = 0; i < buffers.nodeCount; i++) {
    const node = nodes[i]
    const target = i === sel ? SELECT_SCALE : i === hov ? HOVER_SCALE : 1
    scales[i] += (target - scales[i]) * EASE
    const r = buffers.radii[i] * scales[i]
    const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0
    writeScaleTranslate(om, i, r, x, y, z)
    writeScaleTranslate(sm, i, r * SHELL_SCALE, x, y, z)
  }
  orb.instanceMatrix.needsUpdate = true
  shell.instanceMatrix.needsUpdate = true

  if (!ring) return
  const rb = buffers.rings
  const rm = ring.instanceMatrix.array as Float32Array
  let dirty = false
  for (let r = 0; r < rb.ringCount; r++) {
    const i = rb.owners[r]
    const node = nodes[i]
    const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0, s = scales[i]
    const o = r * 4
    if (ringLast[o] === x && ringLast[o + 1] === y && ringLast[o + 2] === z && Math.abs(ringLast[o + 3] - s) < 1e-4) continue
    ringLast[o] = x; ringLast[o + 1] = y; ringLast[o + 2] = z; ringLast[o + 3] = s
    _ringMatrix.compose(_pos.set(x, y, z), RING_TILT, _scale.setScalar(s))
    const base = r * RING_PARTICLES
    for (let j = 0; j < RING_PARTICLES; j++) rm.set(_ringMatrix.elements, (base + j) * 16)
    dirty = true
  }
  if (dirty) ring.instanceMatrix.needsUpdate = true
}
