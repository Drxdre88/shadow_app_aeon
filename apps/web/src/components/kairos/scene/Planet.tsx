'use client'

import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR } from './params'

const ORB_VERTEX = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

// Smooth dual-color gradient glass ball. No noise, no spiral, no stars.
// View-radial composition: bright primary at the centre of the visible disc,
// transitions to a hue-shifted accent toward the silhouette. Sun direction
// adds a subtle directional warmth so the orb still reads as a 3D object.
const ORB_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  uniform vec3 uColor;
  uniform vec3 uSunDir;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 toCam = normalize(cameraPosition - vWorldPos);
    vec3 nrm = normalize(vWorldNormal);

    // 1.0 at the disc centre (facing the viewer head-on), 0.0 at the silhouette.
    float facing = clamp(dot(nrm, toCam), 0.0, 1.0);

    // Two-tone palette derived from the single legend tint.
    vec3 hsvA = rgb2hsv(uColor);
    vec3 colA = hsv2rgb(vec3(hsvA.x, min(hsvA.y * 1.1, 1.0), min(hsvA.z * 1.1, 1.0)));
    vec3 colB = hsv2rgb(vec3(fract(hsvA.x + 0.15), min(hsvA.y * 0.9, 1.0), hsvA.z * 0.82));

    // Centre is primary, rim transitions to accent.
    vec3 col = mix(colB, colA, pow(facing, 1.3));

    // Bright core that triggers bloom.
    col += colA * pow(facing, 4.0) * 1.3;

    // Soft directional lift from the sun so the orb has a faint lit hemisphere.
    float sun = clamp(dot(nrm, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    col *= 0.55 + sun * 0.55;

    gl_FragColor = vec4(col, 1.0);
  }
`

const SHELL_VERTEX = ORB_VERTEX

// Fresnel glass rim. Additive blend — adds a tinted halo at the silhouette,
// transparent through the centre so the gradient ball reads cleanly.
const SHELL_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - abs(dot(viewDir, vWorldNormal)), 2.2);
    float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
    float dayLift = 0.6 + smoothstep(-0.3, 0.4, sunDot) * 0.5;
    vec3 rim = uColor * fres * dayLift * 1.5;
    float alpha = clamp(fres * 0.6, 0.0, 1.0);
    gl_FragColor = vec4(rim, alpha);
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

  const orbMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone() },
          uSunDir: { value: SUN_DIR.clone() },
        },
        vertexShader: ORB_VERTEX,
        fragmentShader: ORB_FRAG,
      }),
    [tint],
  )

  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: tint.clone().lerp(new THREE.Color(0xffffff), 0.25) },
          uSunDir: { value: SUN_DIR.clone() },
        },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAG,
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
        <mesh material={orbMat}>
          <sphereGeometry args={[radius, 48, 48]} />
        </mesh>
        <mesh material={shellMat} scale={1.08}>
          <sphereGeometry args={[radius, 32, 32]} />
        </mesh>
        {hasRing && <PlanetaryRing radius={radius} />}
      </group>
    </group>
  )
})
