'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThoughtVisual } from '@/lib/kairos/aether-types'

// View direction computed in vertex stage — avoids silent cameraPosition
// injection failures that produce black output on some three.js builds.
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

// Core vessel body. uGlow [0..1] drives over-bright output so bloom picks it
// up proportionally — high-salience thoughts blaze; stale ones barely glow.
const ORB_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uGlow;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);

    // 1.0 at visible disc centre, 0.0 at silhouette.
    float facing = clamp(dot(n, v), 0.0, 1.0);

    // Two-tone radial: accent at rim, primary at centre.
    vec3 col = mix(uAccent, uColor, pow(facing, 1.4));

    // Over-bright core — intensity rides uGlow so bloom scales with salience.
    col += uColor * pow(facing, 5.0) * (1.8 + uGlow * 2.2);

    // Soft ambient self-illumination — aether vessels have no sun direction.
    col *= 0.55 + uGlow * 0.45;

    // Rim halo on the silhouette — feeds bloom. Eureka (uGlow~1) blazes.
    float rim = pow(1.0 - facing, 2.6);
    col += uColor * rim * (1.1 + uGlow * 2.8);

    gl_FragColor = vec4(col, 1.0);
  }
`

// Additive backside halo shell — reads from outside as a soft tinted corona.
// Intensity is gated by uGlow so dim/stale thoughts don't bleed.
const SHELL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uGlow;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, -v), 0.0, 1.0);
    float fres = pow(facing, 1.8);
    float intensity = 1.0 + uGlow * 2.2;
    gl_FragColor = vec4(uColor * fres * intensity, fres * (0.55 + uGlow * 0.45));
  }
`

// Rayleigh/Mie atmosphere rim adapted from Swarm's ATMO_FRAG.
// uHueVec drives the Rayleigh colour family; uGlow gates overall opacity so
// high-salience thoughts carry a vivid atmospheric halo.
const ATMO_VERT = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normalize(position));
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

const ATMO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  uniform vec3 uColor;
  uniform float uGlow;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float viewDotN = abs(dot(viewDir, vWorldNormal));
    float limb = pow(1.0 - viewDotN, 3.0);
    // Rayleigh-tinted to vessel hue, no directional sun in the aether field.
    vec3 rayleigh = uColor * limb * (0.8 + uGlow * 1.4);
    // Mie-like forward scatter — viewSunDot replaced with a static soft glow.
    vec3 mie = uColor * 0.6 * limb * uGlow * 1.2;
    vec3 col = rayleigh + mie;
    float alpha = limb * (0.35 + uGlow * 0.55);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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

export type ThoughtContainerProps = ThoughtVisual & {
  onSelect?: (id: string) => void
  onHover?: (id: string | null) => void
}

export function ThoughtContainer({
  thought,
  hue,
  radius,
  glow,
  position,
  selected,
  onSelect,
  onHover,
}: ThoughtContainerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const scaleRef = useRef(1)
  const hovered = useRef(false)

  // Eureka thoughts never fall below 0.92 glow regardless of salience.
  const effectiveGlow = thought.kind === 'eureka' ? Math.max(glow, 0.92) : glow

  // Core colour — vivid saturation, lightness rides glow so dim = less luminous.
  const [cr, cg, cb] = hslToRgb(hue, 0.78, 0.38 + effectiveGlow * 0.28)
  const tint = useMemo(() => new THREE.Color(cr, cg, cb), [cr, cg, cb])

  // Accent: hue-shifted +25° for the two-tone rim gradient.
  const accent = useMemo(() => {
    const [ar, ag, ab] = hslToRgb((hue + 25) % 360, 0.72, 0.55 + effectiveGlow * 0.2)
    return new THREE.Color(ar, ag, ab)
  }, [hue, effectiveGlow])

  const orbMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor:  { value: tint.clone() },
          uAccent: { value: accent.clone() },
          uGlow:   { value: effectiveGlow },
        },
        vertexShader: ORB_VERTEX,
        fragmentShader: ORB_FRAG,
      }),
    [tint, accent, effectiveGlow],
  )

  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.25) },
          uGlow:  { value: effectiveGlow },
        },
        vertexShader: ORB_VERTEX,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    [tint, effectiveGlow],
  )

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone() },
          uGlow:  { value: effectiveGlow },
        },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [tint, effectiveGlow],
  )

  // Target scale: selected = 1.22, hovered = 1.10, default = 1.0
  useFrame((_, delta) => {
    if (!groupRef.current) return
    const target = selected ? 1.22 : hovered.current ? 1.10 : 1.0
    scaleRef.current += (target - scaleRef.current) * Math.min(1, delta * 8)
    groupRef.current.scale.setScalar(scaleRef.current)
  })

  return (
    <group ref={groupRef} position={position}>
      <group
        onPointerDown={(e) => { e.stopPropagation(); onSelect?.(thought.id) }}
        onPointerOver={(e) => { e.stopPropagation(); hovered.current = true; onHover?.(thought.id) }}
        onPointerOut={(e)  => { e.stopPropagation(); hovered.current = false; onHover?.(null) }}
      >
        <mesh material={orbMat}>
          <sphereGeometry args={[radius, 48, 48]} />
        </mesh>
        <mesh material={shellMat} scale={1.18}>
          <sphereGeometry args={[radius, 32, 32]} />
        </mesh>
        <mesh material={atmoMat} scale={1.32}>
          <sphereGeometry args={[radius, 32, 32]} />
        </mesh>
      </group>
    </group>
  )
}
