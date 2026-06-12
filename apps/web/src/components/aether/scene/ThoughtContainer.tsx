'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AetherThought } from '@/lib/kairos/aether-types'

// Fresnel corona shared by the inner rim halo and the wide outer "dark glow".
// uPow controls spread (high = tight rim, low = broad aura).
const HALO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;
  }
`
const HALO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPow;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float fres = pow(clamp(dot(n, -v), 0.0, 1.0), uPow);
    gl_FragColor = vec4(uColor * fres * uIntensity, fres * 0.5 * uIntensity);
  }
`

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

export type ThoughtContainerProps = {
  thought: AetherThought
  hue: number
  radius: number
  glow: number
  seed: number
  position: [number, number, number]
  selected: boolean
  hovered: boolean
  /** Another thought is selected and this one isn't — recede into the dark. */
  dimmed: boolean
  onSelect?: (id: string) => void
  onHover?: (id: string | null) => void
}

export function ThoughtContainer({
  thought,
  hue,
  radius,
  glow,
  seed,
  position,
  selected,
  hovered,
  dimmed,
  onSelect,
  onHover,
}: ThoughtContainerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const orbRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const scaleRef = useRef(1)
  const dimRef = useRef(1)

  const effectiveGlow = thought.kind === 'eureka' ? Math.max(glow, 0.92) : glow
  const h = hue / 360

  const baseColor = useMemo(() => new THREE.Color().setHSL(h, 0.6, 0.34), [h])
  const emissiveColor = useMemo(() => new THREE.Color().setHSL(h, 0.75, 0.55), [h])
  const rimColor = useMemo(() => new THREE.Color().setHSL(h, 0.85, 0.55), [h])
  const deepGlowColor = useMemo(() => new THREE.Color().setHSL(h, 0.95, 0.42), [h])

  // Inner rim halo — tight, bright-ish edge.
  const innerHaloMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: rimColor.clone() },
          uIntensity: { value: 0.35 + effectiveGlow * 0.5 },
          uPow: { value: 2.6 },
        },
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [rimColor, effectiveGlow],
  )

  // Outer luminescent dark glow — wide, deep, soft aura around the orb.
  const outerGlowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: deepGlowColor.clone() },
          uIntensity: { value: 0.22 + effectiveGlow * 0.4 },
          uPow: { value: 1.5 },
        },
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [deepGlowColor, effectiveGlow],
  )

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const phase = seed * 6.2831
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.5 + phase) // 0..1
    const shimmer = 0.82 + 0.18 * Math.sin(t * 0.55 + phase)

    // Spotlight: lerp toward dim when another thought owns the focus.
    dimRef.current += ((dimmed ? 0.26 : 1) - dimRef.current) * Math.min(1, delta * 5)
    const d = dimRef.current

    if (matRef.current) {
      matRef.current.emissiveIntensity = (0.1 + pulse * 0.16) * (0.55 + effectiveGlow * 0.65) * d
      matRef.current.envMapIntensity = 1.1 * (0.4 + 0.6 * d)
      matRef.current.iridescenceThicknessRange[1] = 280 + Math.sin(t * 0.35 + phase) * 130
    }
    innerHaloMat.uniforms.uIntensity.value = (0.35 + effectiveGlow * 0.5) * shimmer * d
    outerGlowMat.uniforms.uIntensity.value = (0.22 + effectiveGlow * 0.4) * shimmer * d

    if (orbRef.current) {
      orbRef.current.rotation.y += delta * 0.05
      orbRef.current.rotation.x += delta * 0.018
    }

    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * 0.5 + phase) * 0.03
      const focusScale = selected ? 1.24 : hovered ? 1.12 : 1.0
      const target = focusScale * breathe * (0.9 + 0.1 * d)
      scaleRef.current += (target - scaleRef.current) * Math.min(1, delta * 8)
      groupRef.current.scale.setScalar(scaleRef.current)
    }
  })

  return (
    <group ref={groupRef} position={position}>
      <group
        onPointerDown={(e) => { e.stopPropagation(); onSelect?.(thought.id) }}
        onPointerOver={(e) => { e.stopPropagation(); onHover?.(thought.id) }}
        onPointerOut={(e)  => { e.stopPropagation(); onHover?.(null) }}
      >
        <mesh ref={orbRef}>
          <sphereGeometry args={[radius, 64, 64]} />
          <meshPhysicalMaterial
            ref={matRef}
            color={baseColor}
            emissive={emissiveColor}
            emissiveIntensity={0.2}
            roughness={0.16}
            metalness={0.2}
            clearcoat={1}
            clearcoatRoughness={0.12}
            iridescence={1}
            iridescenceIOR={1.4}
            iridescenceThicknessRange={[120, 320]}
            envMapIntensity={1.1}
          />
        </mesh>
        <mesh material={innerHaloMat} scale={1.4}>
          <sphereGeometry args={[radius, 24, 24]} />
        </mesh>
        <mesh material={outerGlowMat} scale={2.3}>
          <sphereGeometry args={[radius, 24, 24]} />
        </mesh>
      </group>
    </group>
  )
}
