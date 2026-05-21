'use client'

import { forwardRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR, type PlanetArchetype } from './params'

const SURFACE_VERTEX = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1, 0));
    float c = hash(i + vec2(0, 1));
    float d = hash(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
  }
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
  vec3 paletteShift(vec3 rgb, float shift) {
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + shift);
    return hsv2rgb(hsv);
  }
`

const GAS_GIANT_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal; varying vec3 vWorldPos; varying vec2 vUv;
  uniform vec3 uSunDir; uniform float uTime; uniform float uHue;
  uniform float uPaletteShift;
  ${NOISE_GLSL}
  void main() {
    float lat = vUv.y;
    float lon = vUv.x;
    float turb = fbm(vec2(lon * 8.0, lat * 16.0 + uTime * 0.02)) * 0.18;
    float bands = sin((lat + turb) * 22.0) * 0.5 + 0.5;
    bands = smoothstep(0.25, 0.75, bands);
    float storm = smoothstep(0.86, 0.94, noise(vec2(lon * 4.0, lat * 6.0)));
    vec3 dark = mix(vec3(0.20, 0.12, 0.09), vec3(0.10, 0.18, 0.22), uHue);
    vec3 light = mix(vec3(0.62, 0.42, 0.26), vec3(0.55, 0.48, 0.62), uHue);
    vec3 stormCol = mix(vec3(0.88, 0.45, 0.20), vec3(0.95, 0.78, 0.42), uHue);
    vec3 surf = mix(dark, light, bands);
    surf = mix(surf, stormCol, storm * 0.5);
    float ndotl = dot(vWorldNormal, uSunDir);
    surf *= 0.04 + max(0.0, ndotl) * 1.0;
    float term = exp(-pow(ndotl, 2.0) * 9.0) * smoothstep(-0.4, 0.0, ndotl);
    surf += vec3(0.45, 0.18, 0.08) * term * 0.4;
    surf = paletteShift(surf, uPaletteShift);
    gl_FragColor = vec4(surf, 1.0);
  }
`

const TERRESTRIAL_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal; varying vec3 vWorldPos; varying vec2 vUv;
  uniform vec3 uSunDir; uniform float uTime; uniform float uHue;
  uniform float uPaletteShift;
  ${NOISE_GLSL}
  void main() {
    float c = fbm(vUv * 8.0);
    float continent = smoothstep(0.45, 0.55, c);
    float pole = smoothstep(0.85, 0.95, abs(vUv.y - 0.5) * 2.0);
    float clouds = smoothstep(0.55, 0.85, fbm(vUv * 10.0 + vec2(uTime * 0.01, 0.0)));
    vec3 ocean = mix(vec3(0.05, 0.18, 0.4), vec3(0.08, 0.32, 0.52), uHue);
    vec3 land  = mix(vec3(0.22, 0.32, 0.12), vec3(0.45, 0.32, 0.18), uHue);
    vec3 cloud = vec3(0.92, 0.93, 0.97);
    vec3 ice   = vec3(0.86, 0.92, 0.98);
    vec3 surf = mix(ocean, land, continent);
    surf = mix(surf, ice, pole * 0.85);
    surf = mix(surf, cloud, clouds * 0.55 * (1.0 - pole));
    float ndotl = dot(vWorldNormal, uSunDir);
    surf *= 0.05 + max(0.0, ndotl) * 1.1;
    float night = smoothstep(0.05, -0.1, ndotl);
    float cities = smoothstep(0.78, 0.82, fbm(vUv * 18.0)) * continent * night;
    surf += vec3(1.0, 0.7, 0.35) * cities * 0.8;
    surf = paletteShift(surf, uPaletteShift);
    gl_FragColor = vec4(surf, 1.0);
  }
`

const ICY_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal; varying vec3 vWorldPos; varying vec2 vUv;
  uniform vec3 uSunDir; uniform float uTime; uniform float uHue;
  uniform float uPaletteShift;
  ${NOISE_GLSL}
  void main() {
    float crack = 1.0 - abs(noise(vUv * 28.0) - 0.5) * 2.0;
    crack = pow(crack, 6.0);
    float ridges = fbm(vUv * 12.0) * 0.4;
    vec3 base = mix(vec3(0.78, 0.86, 0.95), vec3(0.62, 0.78, 0.92), uHue);
    vec3 surf = base * (0.85 + ridges * 0.3);
    surf = mix(surf, vec3(0.55, 0.75, 0.95), crack * 0.5);
    float ndotl = dot(vWorldNormal, uSunDir);
    surf *= 0.08 + max(0.0, ndotl) * 1.05;
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h = normalize(viewDir + uSunDir);
    float spec = pow(max(0.0, dot(vWorldNormal, h)), 60.0);
    surf += vec3(1.0, 0.96, 0.92) * spec * max(0.0, ndotl) * 0.5;
    surf = paletteShift(surf, uPaletteShift);
    gl_FragColor = vec4(surf, 1.0);
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
  uniform float uHue;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float viewDotN = abs(dot(viewDir, vWorldNormal));
    float sunDot = dot(vWorldNormal, uSunDir);
    float viewSunDot = dot(viewDir, uSunDir);
    float limb = pow(1.0 - viewDotN, 3.0);
    float dayFactor = smoothstep(-0.25, 0.35, sunDot);
    vec3 rayCol = mix(vec3(0.34, 0.58, 1.05), vec3(0.50, 0.78, 1.15), uHue);
    vec3 rayleigh = rayCol * limb * dayFactor * 1.1;
    float miePhase = pow(max(0.0, viewSunDot * 0.5 + 0.5), 7.0);
    vec3 mie = vec3(1.0, 0.86, 0.62) * miePhase * dayFactor * limb * 1.5;
    float termGauss = exp(-pow(sunDot, 2.0) * 5.5) * smoothstep(-0.35, 0.05, sunDot);
    vec3 termWarm = vec3(1.0, 0.48, 0.18) * termGauss * limb * 1.2;
    float nightLimb = limb * (1.0 - dayFactor) * 0.15;
    vec3 nightCol = vec3(0.18, 0.22, 0.42) * nightLimb;
    vec3 col = rayleigh + mie + termWarm + nightCol;
    float alpha = (limb * (0.55 + dayFactor * 0.45)) + termGauss * 0.6;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`

function surfaceFragFor(arch: PlanetArchetype): string {
  if (arch === 'terrestrial') return TERRESTRIAL_FRAG
  if (arch === 'icy') return ICY_FRAG
  return GAS_GIANT_FRAG
}

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
  archetype: PlanetArchetype
  surfaceHue: number
  atmosphereHue: number
  paletteShift: number
  hasRing?: boolean
  spinSpeed?: number
  onPointerDown?: (e: { stopPropagation: () => void }) => void
  onPointerOver?: (e: { stopPropagation: () => void }) => void
  onPointerOut?: (e: { stopPropagation: () => void }) => void
}

export const Planet = forwardRef<THREE.Group, PlanetProps>(function Planet(
  { radius, archetype, surfaceHue, atmosphereHue, paletteShift, hasRing = false, spinSpeed = 0.008, onPointerDown, onPointerOver, onPointerOut },
  groupRef,
) {
  const innerRef = useRef<THREE.Group>(null)

  const surfaceMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: SUN_DIR.clone() },
          uTime: { value: 0 },
          uHue: { value: surfaceHue },
          uPaletteShift: { value: paletteShift },
        },
        vertexShader: SURFACE_VERTEX,
        fragmentShader: surfaceFragFor(archetype),
      }),
    [archetype, surfaceHue, paletteShift],
  )

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: SUN_DIR.clone() },
          uHue: { value: atmosphereHue },
        },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [atmosphereHue],
  )

  useFrame((state) => {
    if (innerRef.current) {
      innerRef.current.rotation.y = state.clock.elapsedTime * spinSpeed
    }
    surfaceMat.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <group ref={groupRef}>
      <group
        ref={innerRef}
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <mesh material={surfaceMat}>
          <sphereGeometry args={[radius, 96, 96]} />
        </mesh>
        <mesh material={atmoMat} scale={1.12}>
          <sphereGeometry args={[radius, 64, 64]} />
        </mesh>
        {hasRing && <PlanetaryRing radius={radius} />}
      </group>
    </group>
  )
})
