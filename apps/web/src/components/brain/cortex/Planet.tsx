'use client'

import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR } from './params'

const MATTE_VERTEX = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

// Soft wrap lighting from a single sun direction. Floor on the dark side
// keeps the planet's tint readable in shadow. No surface noise, no time
// animation — clean matte sphere with a gradient between sun-lit and dark.
const MATTE_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal;
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  void main() {
    float ndotl = dot(vWorldNormal, normalize(uSunDir));
    float lighting = pow(clamp(ndotl * 0.5 + 0.5, 0.0, 1.0), 1.35);
    float lit = 0.16 + lighting * 0.84;
    vec3 col = uColor * lit;
    // Subtle warmth shift on the lit hemisphere so it doesn't read flat.
    col = mix(col, col * vec3(1.06, 1.02, 0.98), lighting);
    gl_FragColor = vec4(col, 1.0);
  }
`

const ATMO_VERT = `
  varying vec3 vWorldNormal; varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normalize(position));
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

const ATMO_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal; varying vec3 vWorldPos;
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float viewDotN = abs(dot(viewDir, vWorldNormal));
    float sunDot = dot(vWorldNormal, normalize(uSunDir));
    float limb = pow(1.0 - viewDotN, 3.0);
    float dayFactor = smoothstep(-0.25, 0.35, sunDot);
    vec3 rim = uColor * limb * (0.4 + dayFactor * 0.9) * 1.15;
    float alpha = limb * (0.45 + dayFactor * 0.45);
    gl_FragColor = vec4(rim, clamp(alpha, 0.0, 1.0));
  }
`

function PlanetaryRing({ radius }: { radius: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const COUNT = 600
  const inner = radius * 1.35
  const outer = radius * 2.1
  const data = useMemo(() => {
    return Array.from({ length: COUNT }, () => {
      const ang = Math.random() * Math.PI * 2
      const r = inner + Math.pow(Math.random(), 0.5) * (outer - inner)
      return {
        ang,
        r,
        y: (Math.random() - 0.5) * 0.4,
        scale: 0.06 + Math.random() * 0.25,
        rotSpeed: 0.04 + Math.random() * 0.02,
      }
    })
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

  const surfaceMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: SUN_DIR.clone() },
          uColor: { value: tint.clone() },
        },
        vertexShader: MATTE_VERTEX,
        fragmentShader: MATTE_FRAG,
      }),
    [tint],
  )

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: SUN_DIR.clone() },
          uColor: { value: tint.clone().lerp(new THREE.Color(0xffffff), 0.35) },
        },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
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
        <mesh material={surfaceMat}>
          <sphereGeometry args={[radius, 48, 48]} />
        </mesh>
        <mesh material={atmoMat} scale={1.13}>
          <sphereGeometry args={[radius, 32, 32]} />
        </mesh>
        {hasRing && <PlanetaryRing radius={radius} />}
      </group>
    </group>
  )
})
