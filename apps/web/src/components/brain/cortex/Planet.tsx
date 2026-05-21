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

// View-aligned galaxy swirl. Project the surface normal onto a 2D frame built
// around the camera direction so the spiral always faces the viewer — same
// trick as billboarded sprites, but on a real 3D sphere with proper occlusion.
// Two colors derived in-shader from a single tint (so the legend stays clean):
// primary = the realm/repo hue passed in; accent = hue-shifted +0.18 on HSV.
const ORB_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  uniform vec3 uColor;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
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

  void main() {
    // Build a view-aligned tangent frame on this fragment.
    vec3 toCam = normalize(cameraPosition - vWorldPos);
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(worldUp, toCam));
    vec3 up = normalize(cross(toCam, right));
    vec3 nrm = normalize(vWorldNormal);

    vec2 viewUV = vec2(dot(nrm, right), dot(nrm, up));
    float r = length(viewUV);
    float ang = atan(viewUV.y, viewUV.x);

    // Spiral galaxy arms — slow rotational drift (very gentle, no flashing).
    float spiral = sin(ang * 2.5 + r * 14.0 + uTime * 0.06) * 0.5 + 0.5;
    spiral *= smoothstep(1.0, 0.12, r);

    // Nebula cloud structure inside the orb.
    float clouds = fbm(viewUV * 4.5 + vec2(uTime * 0.015)) * smoothstep(1.0, 0.35, r);

    // Bright core glow.
    float core = exp(-r * 3.5) * 1.6;

    // Stars: sparse high-frequency peaks — fixed in object space so they
    // stay put on the sphere as the camera orbits (anchored to vWorldNormal,
    // not viewUV, so the stars don't always face the viewer).
    float stars = pow(fbm(nrm.xy * 60.0 + nrm.z * 30.0), 14.0) * 5.0;

    // Two-color palette derived from the single tint uniform.
    vec3 hsvA = rgb2hsv(uColor);
    vec3 colA = hsv2rgb(vec3(hsvA.x, min(hsvA.y * 1.2, 1.0), min(hsvA.z * 1.1, 1.0)));
    vec3 colB = hsv2rgb(vec3(fract(hsvA.x + 0.18), min(hsvA.y * 0.95, 1.0), hsvA.z));

    // Mix swirl t = spiral × clouds weight, then composite.
    float t = clamp(spiral * 0.6 + clouds * 0.55, 0.0, 1.0);
    vec3 col = mix(colA, colB, t);
    col *= 0.25 + clouds * 1.1 + spiral * 0.7;
    col += colA * core * 1.8;
    col += vec3(1.0, 0.96, 0.9) * stars * 1.4;

    gl_FragColor = vec4(col, 1.0);
  }
`

// Glass shell — fresnel rim glow. Transparent in the middle so the orb's
// galaxy reads through cleanly.
const SHELL_VERTEX = ORB_VERTEX

const SHELL_FRAG = `
  precision highp float;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - abs(dot(viewDir, vWorldNormal)), 2.4);
    float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
    float dayLift = 0.5 + smoothstep(-0.3, 0.4, sunDot) * 0.5;
    vec3 rim = uColor * fres * dayLift * 1.6;
    float alpha = clamp(fres * 0.65, 0.0, 1.0);
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
          uTime: { value: 0 },
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

  useFrame((state) => {
    orbMat.uniforms.uTime.value = state.clock.elapsedTime
  })

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
