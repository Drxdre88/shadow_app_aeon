'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const VERTEX = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vMag;
  uniform float uTime;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    float t1 = sin(uTime * 0.9 + aPhase) * 0.5 + 0.5;
    float t2 = sin(uTime * 2.3 + aPhase * 1.7) * 0.5 + 0.5;
    vMag = mix(t1, t2, 0.5) * 0.30 + 0.50;
    vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * vMag * uPixelRatio * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const FRAGMENT = `
  precision highp float;
  varying vec3 vColor;
  varying float vMag;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float halo = exp(-d * 13.0);
    float spike = exp(-abs(c.x) * 75.0) + exp(-abs(c.y) * 75.0);
    spike *= step(d, 0.48) * smoothstep(4.0, 9.0, vMag * 8.0) * 0.12;
    vec3 col = vColor * (pow(core, 1.8) * 0.85 + halo * 0.30);
    col += vec3(1.0, 0.95, 0.9) * spike * vMag;
    float alpha = max(core, halo * 0.5);
    gl_FragColor = vec4(col * vMag, alpha);
  }
`

function buildGeometry(count: number, radius: number, depthRange: number, brightnessBoost: number) {
  const g = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const phases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = radius * (0.5 + Math.random() * 0.5)
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi) * 0.6 - depthRange * 0.4 + Math.random() * depthRange * 0.8
    const isHero = Math.random() < 0.05
    const mag = isHero ? 0.7 + Math.random() * 0.3 : Math.pow(Math.random(), 5.5)
    const sizeMul = isHero ? 1.6 : 1.0
    sizes[i] = (0.35 + mag * 4.0) * brightnessBoost * sizeMul
    const cls = Math.random()
    let cr: number, cg: number, cb: number
    if (cls < 0.03)      { cr = 0.65; cg = 0.78; cb = 1.15 }
    else if (cls < 0.12) { cr = 0.82; cg = 0.92; cb = 1.10 }
    else if (cls < 0.30) { cr = 0.95; cg = 0.98; cb = 1.05 }
    else if (cls < 0.55) { cr = 1.05; cg = 1.02; cb = 0.92 }
    else if (cls < 0.80) { cr = 1.15; cg = 0.92; cb = 0.72 }
    else                 { cr = 1.20; cg = 0.65; cb = 0.55 }
    const luma = 0.18 + mag * 0.95
    colors[i * 3]     = cr * luma
    colors[i * 3 + 1] = cg * luma
    colors[i * 3 + 2] = cb * luma
    phases[i] = Math.random() * Math.PI * 2
  }
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1))
  g.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3))
  g.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1))
  return g
}

function CinematicStarLayer({
  count, radius, depthRange, base, brightnessBoost,
}: {
  count: number; radius: number; depthRange: number; base: number; brightnessBoost: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const geometry = useMemo(() => buildGeometry(count, radius, depthRange, brightnessBoost), [count, radius, depthRange, brightnessBoost])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio()
  })

  return (
    <group ref={groupRef} position={[0, 0, base]}>
      <points geometry={geometry} material={material} />
    </group>
  )
}

// Layer radii / depths / bases scaled ~5× from Swarm to fit Aeon's wider camera
// (camera at z=380 vs Swarm's z~15). Counts kept identical → ~22k stars total.
const LAYERS = [
  { count: 2800, radius: 250,  depthRange: 125,  base: -75,   brightnessBoost: 0.55 },
  { count: 3600, radius: 375,  depthRange: 250,  base: -225,  brightnessBoost: 0.65 },
  { count: 4400, radius: 550,  depthRange: 400,  base: -500,  brightnessBoost: 0.75 },
  { count: 5200, radius: 800,  depthRange: 550,  base: -900,  brightnessBoost: 0.85 },
  { count: 6000, radius: 1100, depthRange: 700,  base: -1400, brightnessBoost: 0.95 },
]

export function CinematicStarfield() {
  return (
    <>
      {LAYERS.map((l, i) => (
        <CinematicStarLayer
          key={i}
          count={l.count}
          radius={l.radius}
          depthRange={l.depthRange}
          base={l.base}
          brightnessBoost={l.brightnessBoost}
        />
      ))}
    </>
  )
}
