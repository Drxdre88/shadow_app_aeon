'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIR } from './params'

const VERTEX = `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

const FRAGMENT = `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uDriftSeed;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec3(1,0,0));
    float c = hash(i + vec3(0,1,0));
    float d = hash(i + vec3(1,1,0));
    float e = hash(i + vec3(0,0,1));
    float fh = hash(i + vec3(1,0,1));
    float g = hash(i + vec3(0,1,1));
    float h = hash(i + vec3(1,1,1));
    return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
               mix(mix(e,fh,f.x), mix(g,h,f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0; float amp = 0.55;
    for (int i = 0; i < 4; i++) { v += amp * noise(p); p *= 2.1; amp *= 0.5; }
    return v;
  }
  float density(vec3 p) {
    vec3 q = (p - uCenter) / uRadius;
    float r = length(q);
    if (r > 0.95) return 0.0;
    vec3 np = q * 1.6 + vec3(uTime * 0.015 + uDriftSeed);
    float d = fbm(np) * 1.65;
    d *= smoothstep(0.95, 0.15, r);
    d = smoothstep(0.18, 0.62, d);
    return max(0.0, d);
  }
  vec2 raySphereIntersect(vec3 ro, vec3 rd, vec3 ctr, float rad) {
    vec3 oc = ro - ctr;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - rad * rad;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - ro);
    vec2 ts = raySphereIntersect(ro, rd, uCenter, uRadius);
    if (ts.y < 0.0) discard;
    float tStart = max(0.0, ts.x);
    float tEnd = ts.y;
    const int STEPS = 16;
    float stepLen = (tEnd - tStart) / float(STEPS);
    vec3 accColor = vec3(0.0);
    float transmittance = 1.0;
    float g = 0.55;
    float vDotL = dot(rd, normalize(uSunDir));
    float gg = g * g;
    float phase = (1.0 - gg) / (4.0 * 3.14159 * pow(max(1.0 + gg - 2.0 * g * vDotL, 0.001), 1.5));
    for (int i = 0; i < STEPS; i++) {
      float t = tStart + stepLen * (float(i) + 0.5);
      vec3 p = ro + rd * t;
      float d = density(p);
      if (d > 0.005) {
        float lightD = 0.0;
        vec3 lp = p;
        for (int j = 1; j <= 3; j++) {
          lp += normalize(uSunDir) * uRadius * 0.15;
          lightD += density(lp);
        }
        float lightAtten = exp(-lightD * 2.5);
        float ambient = 0.07;
        vec3 inscatter = uColor * (lightAtten * phase * 12.0 + ambient);
        float absorb = exp(-d * stepLen * 0.085);
        accColor += transmittance * (1.0 - absorb) * inscatter;
        transmittance *= absorb;
        if (transmittance < 0.01) break;
      }
    }
    float alpha = (1.0 - transmittance) * uOpacity;
    gl_FragColor = vec4(accColor, clamp(alpha, 0.0, 1.0));
  }
`

export function RaymarchedNebula({
  center,
  radius,
  color,
  opacity = 0.55,
  driftSeed = 0,
}: {
  center: [number, number, number]
  radius: number
  color: string
  opacity?: number
  driftSeed?: number
}) {
  const ref = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uSunDir: { value: SUN_DIR.clone() },
      uCenter: { value: new THREE.Vector3(...center) },
      uRadius: { value: radius },
      uOpacity: { value: opacity },
      uDriftSeed: { value: driftSeed },
    }),
    [color, radius, driftSeed, center, opacity],
  )

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh ref={ref} position={center}>
      <sphereGeometry args={[radius, 24, 24]} />
      <shaderMaterial
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
      />
    </mesh>
  )
}
