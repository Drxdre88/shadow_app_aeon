'use client'

import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR } from './params'

// View direction is computed in the vertex shader and passed as a varying.
// This avoids depending on `cameraPosition` being auto-injected into the
// fragment stage — that injection silently failed on some three.js builds
// and produced black planets. modelViewMatrix is always available, so this
// works everywhere.
const ORB_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;
  }
`

// Two-tone gradient body with directional sun lift, bright core, and an
// atmospheric rim halo on the silhouette. Output is unclamped so very bright
// regions trigger bloom in post.
const ORB_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform vec3 uSunDirView;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);

    // 1.0 at the centre of the visible disc, 0.0 at the silhouette.
    float facing = clamp(dot(n, v), 0.0, 1.0);

    // Two-tone radial composition: accent at the rim, primary in the centre.
    vec3 col = mix(uAccent, uColor, pow(facing, 1.4));

    // Bright over-bright core to trigger bloom.
    col += uColor * pow(facing, 5.0) * 1.8;

    // Directional shading so the orb reads as a 3D object even at distance.
    float sun = clamp(dot(n, normalize(uSunDirView)) * 0.5 + 0.5, 0.0, 1.0);
    col *= 0.42 + sun * 0.62;

    // Atmosphere glow that wraps onto the silhouette — adds depth and feeds bloom.
    float rim = pow(1.0 - facing, 2.6);
    col += uColor * rim * 1.1;

    gl_FragColor = vec4(col, 1.0);
  }
`

// Backside additive halo. No view-direction maths — just renders the inside
// of a slightly larger sphere with additive blending, which from outside reads
// as a soft tinted glow wrapping the orb. Cheap and bloom-friendly.
const SHELL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, -v), 0.0, 1.0);
    float fres = pow(facing, 1.8);
    gl_FragColor = vec4(uColor * fres * 1.6, fres * 0.85);
  }
`

function PlanetaryRing({ radius }: { radius: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const COUNT = 600
  const inner = radius * 1.35
  const outer = radius * 2.1
  const data = useMemo(() => {
    return Array.from({ length: COUNT }, () => ({
      ang: Math.random() * Math.PI * 2,
      r: inner + Math.pow(Math.random(), 0.5) * (outer - inner),
      y: (Math.random() - 0.5) * 0.4,
      scale: 0.06 + Math.random() * 0.25,
      rotSpeed: 0.04 + Math.random() * 0.02,
    }))
  }, [inner, outer])

  useFrame((_, delta) => {
    if (!ref.current) return
    for (let i = 0; i < COUNT; i++) {
      const d = data[i]
      d.ang += d.rotSpeed * delta
      dummy.position.set(Math.cos(d.ang) * d.r, d.y, Math.sin(d.ang) * d.r)
      dummy.scale.setScalar(d.scale)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} rotation={[0.4, 0, 0.15]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#a89880" roughness={0.95} metalness={0.05} flatShading />
    </instancedMesh>
  )
}

export type PlanetProps = {
  radius: number
  color: string
  hasRing?: boolean
  onPointerDown?: (e: { stopPropagation: () => void }) => void
  onPointerOver?: (e: { stopPropagation: () => void }) => void
  onPointerOut?: (e: { stopPropagation: () => void }) => void
}

export const Planet = forwardRef<THREE.Group, PlanetProps>(function Planet(
  { radius, color, hasRing = false, onPointerDown, onPointerOver, onPointerOut },
  groupRef,
) {
  const tint = useMemo(() => new THREE.Color(color), [color])

  // Accent is a brighter, hue-shifted variant for the rim. We compute it once
  // off the tint via HSL math in JS so the shader stays branchless.
  const accent = useMemo(() => {
    const c = tint.clone()
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    c.setHSL((hsl.h + 0.08) % 1, Math.min(1, hsl.s * 1.05), Math.min(0.85, hsl.l * 1.25))
    return c
  }, [tint])

  const orbMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: tint.clone() },
          uAccent:     { value: accent.clone() },
          uSunDirView: { value: SUN_DIR.clone() },
        },
        vertexShader: ORB_VERTEX,
        fragmentShader: ORB_FRAG,
      }),
    [tint, accent],
  )

  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone().lerp(new THREE.Color(0xffffff), 0.30) },
        },
        vertexShader: ORB_VERTEX,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [tint],
  )

  return (
    <group ref={groupRef}>
      <group
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <mesh material={orbMat}>
          <sphereGeometry args={[radius, 48, 48]} />
        </mesh>
        <mesh material={shellMat} scale={1.18}>
          <sphereGeometry args={[radius, 32, 32]} />
        </mesh>
        {hasRing && <PlanetaryRing radius={radius} />}
      </group>
    </group>
  )
})
