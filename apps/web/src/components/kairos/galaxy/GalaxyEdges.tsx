'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { SceneNode } from '../scene/PlanetCloud'
import { fillIdentity, writeEdgePositions, writeParticleMatrices, type EdgeBucket, type GalaxyBuffers } from './buffers'

// Old edges were Lambert-lit cylinders (ambient 0.22 + sun 1.2, /π in three's
// physical lighting ≈ 0.3–0.45× the base colour). Fat lines are unlit, so the
// base colour is scaled to land in the same brightness band.
const EDGE_LIT = 0.4
const EDGE_OPACITY = 0.85
// force-graph photons: SphereGeometry(ceil(1.7*10)/10/2, 4, 4), opacity linkOpacity×3.
const PARTICLE_RADIUS = 0.85

type Props = { nodes: SceneNode[]; buffers: GalaxyBuffers }

type Built = {
  lines: { bucket: EdgeBucket; obj: LineSegments2; geo: LineSegmentsGeometry; mat: LineMaterial }[]
  particles: THREE.InstancedMesh | null
}

function updateEdges(built: Built, buffers: GalaxyBuffers, nodes: SceneNode[], frame: number): void {
  for (const l of built.lines) {
    writeEdgePositions(l.bucket, nodes)
    ;(l.geo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true
  }
  if (built.particles) {
    writeParticleMatrices(buffers.particles, nodes, frame, built.particles.instanceMatrix.array as Float32Array)
    built.particles.instanceMatrix.needsUpdate = true
  }
}

// Every edge in one fat-line batch per style bucket (width / curvature), and
// every directional particle in one InstancedMesh.
export function GalaxyEdges({ nodes, buffers }: Props) {
  const built = useMemo<Built>(() => {
    const lines = buffers.edges.map((b) => {
      const geo = new LineSegmentsGeometry()
      geo.setPositions(b.positions)
      geo.setColors(b.colors)
      ;(geo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.setUsage(THREE.DynamicDrawUsage)
      const mat = new LineMaterial({
        color: new THREE.Color(EDGE_LIT, EDGE_LIT, EDGE_LIT),
        linewidth: b.width,
        worldUnits: true,
        vertexColors: true,
        transparent: true,
        opacity: EDGE_OPACITY,
      })
      const obj = new LineSegments2(geo, mat)
      obj.frustumCulled = false
      obj.raycast = () => {}
      return { bucket: b, obj, geo, mat }
    })

    const pb = buffers.particles
    let particles: THREE.InstancedMesh | null = null
    if (pb.count > 0) {
      const geo = new THREE.SphereGeometry(PARTICLE_RADIUS, 4, 4)
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: EDGE_OPACITY * 3 })
      particles = new THREE.InstancedMesh(geo, mat, pb.count)
      fillIdentity(particles.instanceMatrix.array as Float32Array, pb.count)
      particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      particles.instanceColor = new THREE.InstancedBufferAttribute(pb.colors, 3)
      particles.frustumCulled = false
      particles.raycast = () => {}
    }
    return { lines, particles }
  }, [buffers])

  useEffect(() => () => {
    for (const l of built.lines) {
      l.geo.dispose()
      l.mat.dispose()
    }
    if (built.particles) {
      built.particles.geometry.dispose()
      ;(built.particles.material as THREE.Material).dispose()
      built.particles.dispose()
    }
  }, [built])

  const frame = useRef(0)
  useFrame(() => {
    frame.current += 1
    updateEdges(built, buffers, nodes, frame.current)
  })

  return (
    <>
      {built.lines.map((l) => (
        <primitive key={l.bucket.key} object={l.obj} />
      ))}
      {built.particles && <primitive object={built.particles} />}
    </>
  )
}
