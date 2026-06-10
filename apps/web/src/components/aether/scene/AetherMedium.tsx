'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ─── Shared sun direction (matches kairos/scene/params.ts convention) ────────
const SUN_DIR = new THREE.Vector3(0.4, 0.6, 0.8).normalize()

// ─── Volumetric nebula GLSL ───────────────────────────────────────────────────
const NEBULA_VERTEX = `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`

// Adaptation of kairos RaymarchedNebula + Swarm HG-phase technique.
// Key aether changes:
//   – g=0.35 (forward-biased HG, gentler scattering for haze vs directional cloud)
//   – ambient 0.18 (higher fill so the dark field glows, not just the lit side)
//   – inscatter multiplier 7.0 (dimmer than Swarm's 12 — a haze, not a cloud)
//   – absorb coefficient 0.04 (very transparent — want bleed-through depth)
//   – uOpacity drives final fade so intensity knob works
//   – unclamped alpha (can exceed 1.0 briefly; bloom will catch it)
const NEBULA_FRAGMENT = `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3  uColor;
  uniform vec3  uSunDir;
  uniform vec3  uCenter;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uDriftSeed;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a=hash(i),               b=hash(i+vec3(1,0,0));
    float c=hash(i+vec3(0,1,0)),   d=hash(i+vec3(1,1,0));
    float e=hash(i+vec3(0,0,1)),   fh=hash(i+vec3(1,0,1));
    float g=hash(i+vec3(0,1,1)),   h=hash(i+vec3(1,1,1));
    return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),
               mix(mix(e,fh,f.x),mix(g,h,f.x),f.y),f.z);
  }
  float fbm(vec3 p) {
    float v=0.0; float amp=0.55;
    for(int i=0;i<5;i++){ v+=amp*noise(p); p*=2.1; amp*=0.5; }
    return v;
  }
  float density(vec3 p) {
    vec3 q = (p - uCenter) / uRadius;
    float r = length(q);
    if(r > 0.95) return 0.0;
    // Two-octave drift: slow large-scale waft + finer micro-turbulence
    vec3 np = q * 1.4 + vec3(uTime*0.008 + uDriftSeed);
    np     += vec3(sin(uTime*0.006+uDriftSeed)*0.12, cos(uTime*0.005+uDriftSeed)*0.09, 0.0);
    float d = fbm(np) * 1.5;
    d *= smoothstep(0.95, 0.2, r);
    d  = smoothstep(0.15, 0.58, d);
    return max(0.0, d);
  }
  vec2 raySphereIntersect(vec3 ro, vec3 rd, vec3 ctr, float rad) {
    vec3 oc = ro - ctr;
    float b = dot(oc,rd);
    float c = dot(oc,oc) - rad*rad;
    float h = b*b - c;
    if(h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b-h, -b+h);
  }
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - ro);
    vec2 ts = raySphereIntersect(ro, rd, uCenter, uRadius);
    if(ts.y < 0.0) discard;
    float tStart = max(0.0, ts.x);
    float tEnd   = ts.y;
    const int STEPS = 20;
    float stepLen = (tEnd - tStart) / float(STEPS);
    vec3  accColor      = vec3(0.0);
    float transmittance = 1.0;
    // HG forward-biased phase (g=0.35 — gentler than Swarm's 0.55)
    float g    = 0.35;
    float vDotL = dot(rd, normalize(uSunDir));
    float gg   = g*g;
    float phase = (1.0-gg) / (4.0*3.14159 * pow(max(1.0+gg-2.0*g*vDotL,0.001), 1.5));
    for(int i=0; i<STEPS; i++) {
      float t = tStart + stepLen*(float(i)+0.5);
      vec3  p = ro + rd*t;
      float d = density(p);
      if(d > 0.005) {
        float lightD = 0.0;
        vec3  lp = p;
        for(int j=1; j<=3; j++) {
          lp    += normalize(uSunDir)*uRadius*0.12;
          lightD += density(lp);
        }
        float lightAtten = exp(-lightD*1.8);
        float ambient    = 0.18;
        vec3  inscatter  = uColor*(lightAtten*phase*7.0 + ambient);
        float absorb     = exp(-d*stepLen*0.04);
        accColor        += transmittance*(1.0-absorb)*inscatter;
        transmittance   *= absorb;
        if(transmittance < 0.01) break;
      }
    }
    float alpha = (1.0 - transmittance) * uOpacity;
    // Intentionally unclamped — feeds bloom
    gl_FragColor = vec4(accColor, alpha);
  }
`

// ─── Starfield GLSL ───────────────────────────────────────────────────────────
// Adapted from Aeon's CinematicStarfield with Swarm's infinite per-particle
// z-wrap (uOffset+uDepthRange in vertex shader, no group teleport).
// Bimodal magnitude distribution preserved (5% hero stars).
// Twinkle range trimmed to [0.50..0.80] — calm, not flashing.
const STAR_VERTEX = `
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;
  varying vec3  vColor;
  varying float vMag;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOffset;
  uniform float uDepthRange;
  void main() {
    vColor = aColor;
    float t1 = sin(uTime*0.7 + aPhase      )*0.5+0.5;
    float t2 = sin(uTime*1.8 + aPhase*1.7  )*0.5+0.5;
    vMag = mix(t1,t2,0.5)*0.30 + 0.50;
    float zWrapped = mod(position.z + uOffset, uDepthRange) - uDepthRange*0.5;
    vec3  wrappedPos = vec3(position.x, position.y, zWrapped);
    vec4  mv = viewMatrix * modelMatrix * vec4(wrappedPos, 1.0);
    gl_PointSize = aSize * vMag * uPixelRatio * (320.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`

const STAR_FRAGMENT = `
  precision highp float;
  varying vec3  vColor;
  varying float vMag;
  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    if(d > 0.5) discard;
    float core  = smoothstep(0.5, 0.0, d);
    float halo  = exp(-d*13.0);
    float spike = exp(-abs(c.x)*75.0) + exp(-abs(c.y)*75.0);
    spike *= step(d,0.48) * smoothstep(4.0,9.0,vMag*8.0) * 0.10;
    vec3 col = vColor*(pow(core,1.8)*0.85 + halo*0.30);
    col += vec3(1.0,0.96,0.92)*spike*vMag;
    float alpha = max(core, halo*0.5);
    gl_FragColor = vec4(col*vMag, alpha);
  }
`

function buildStarGeometry(count: number, radius: number, depthRange: number, boost: number) {
  const g         = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const sizes     = new Float32Array(count)
  const colors    = new Float32Array(count * 3)
  const phases    = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = radius * (0.5 + Math.random() * 0.5)
    positions[i*3]   = r * Math.sin(phi) * Math.cos(theta)
    positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i*3+2] = r * Math.cos(phi) * 0.6 - depthRange*0.4 + Math.random()*depthRange*0.8
    const isHero = Math.random() < 0.05
    const mag    = isHero ? 0.7 + Math.random()*0.3 : Math.pow(Math.random(), 5.5)
    sizes[i]     = (0.35 + mag*4.0) * boost * (isHero ? 1.6 : 1.0)
    const cls = Math.random()
    let cr: number, cg: number, cb: number
    if      (cls < 0.03) { cr=0.65; cg=0.78; cb=1.15 }
    else if (cls < 0.12) { cr=0.82; cg=0.92; cb=1.10 }
    else if (cls < 0.30) { cr=0.95; cg=0.98; cb=1.05 }
    else if (cls < 0.55) { cr=1.05; cg=1.02; cb=0.92 }
    else if (cls < 0.80) { cr=1.15; cg=0.92; cb=0.72 }
    else                 { cr=1.20; cg=0.65; cb=0.55 }
    const luma     = 0.18 + mag*0.95
    colors[i*3]   = cr*luma
    colors[i*3+1] = cg*luma
    colors[i*3+2] = cb*luma
    phases[i]     = Math.random()*Math.PI*2
  }
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1))
  g.setAttribute('aColor',   new THREE.BufferAttribute(colors,    3))
  g.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1))
  return g
}

// Calm aether starfield: 2 layers, lower star count than Swarm,
// no warp speed — the field is still, gently twinkling.
const STAR_LAYERS = [
  { count: 900,  radius: 350, depthRange: 220, base: -180, boost: 0.65 },
  { count: 1400, radius: 700, depthRange: 480, base: -700, boost: 0.82 },
]

function AetherStarLayer({
  count, radius, depthRange, base, boost, intensity,
}: {
  count: number; radius: number; depthRange: number; base: number; boost: number; intensity: number
}) {
  const geometry = useMemo(
    () => buildStarGeometry(count, radius, depthRange, boost * intensity),
    [count, radius, depthRange, boost, intensity],
  )
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime:       { value: 0 },
          uPixelRatio: { value: 1 },
          uOffset:     { value: 0 },
          uDepthRange: { value: depthRange },
        },
        vertexShader:   STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent:    true,
        depthWrite:     false,
        depthTest:      false,
        blending:       THREE.AdditiveBlending,
      }),
    [depthRange],
  )

  useFrame((state) => {
    material.uniforms.uTime.value       = state.clock.elapsedTime
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio()
    // Very slow ambient drift — the stars breathe, not travel
    material.uniforms.uOffset.value += 0.06
    if (material.uniforms.uOffset.value > 1e6) material.uniforms.uOffset.value -= 1e6
  })

  return (
    <group position={[0, 0, base]}>
      <points geometry={geometry} material={material} />
    </group>
  )
}

// ─── Canvas-texture nebula sprite (NebulaSprite pattern) ─────────────────────
function buildSpriteTexture(): THREE.CanvasTexture {
  const size = 512
  const c    = document.createElement('canvas')
  c.width = c.height = size
  const ctx  = c.getContext('2d')!
  const g    = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  g.addColorStop(0,    'rgba(255,255,255,0.85)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.65, 'rgba(255,255,255,0.07)')
  g.addColorStop(1,    'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 600; i++) {
    const ang  = Math.random()*Math.PI*2
    const rad  = Math.pow(Math.random(), 1.4)*size*0.44
    const x    = size/2 + Math.cos(ang)*rad
    const y    = size/2 + Math.sin(ang)*rad
    const dotR = 1.5 + Math.random()*4
    ctx.fillStyle = `rgba(255,255,255,${0.02+Math.random()*0.06})`
    ctx.beginPath()
    ctx.arc(x, y, dotR, 0, Math.PI*2)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function AetherSprite({
  position, color, scale, driftSeed, opacity,
}: {
  position: [number, number, number]
  color: string
  scale: number
  driftSeed: number
  opacity: number
}) {
  const ref = useRef<THREE.Mesh>(null)
  const tex  = useMemo(() => buildSpriteTexture(), [])
  useFrame((state) => {
    if (!ref.current) return
    const t      = state.clock.elapsedTime
    ref.current.rotation.z = Math.sin(t*0.03 + driftSeed)*0.14
    const breathe = 1 + Math.sin(t*0.12 + driftSeed)*0.06
    ref.current.scale.set(scale*breathe, scale*breathe, 1)
  })
  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={tex}
        color={color}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={opacity}
      />
    </mesh>
  )
}

// ─── Nebula volumes ───────────────────────────────────────────────────────────
// Four overlapping hazes at different depths produce the colour-field depth.
// Colors span violet→indigo→teal so the medium feels chromatic, not monolithic.
const NEBULA_CONFIGS = [
  { center: [  0,  30, -180] as [number,number,number], color: '#4422cc', radius: 200, opacity: 0.28, drift: 0.0  },
  { center: [ 80, -20, -320] as [number,number,number], color: '#1a3388', radius: 160, opacity: 0.22, drift: 1.7  },
  { center: [-60,  50, -120] as [number,number,number], color: '#2a1166', radius: 140, opacity: 0.20, drift: 3.3  },
  { center: [ 20, -60, -260] as [number,number,number], color: '#0d4455', radius: 180, opacity: 0.18, drift: 5.1  },
]

// Sprite tints — warm accent hazes that counterpoint the cool nebula volumes
const SPRITE_CONFIGS = [
  { position: [-120,  60, -400] as [number,number,number], color: '#7733ee', scale: 420, drift: 0.4,  opacity: 0.12 },
  { position: [ 140, -80, -500] as [number,number,number], color: '#2244bb', scale: 380, drift: 2.1,  opacity: 0.10 },
  { position: [  20,  90, -350] as [number,number,number], color: '#334488', scale: 340, drift: 4.2,  opacity: 0.09 },
]

// ─── AetherNebula (single volume) ────────────────────────────────────────────
function AetherNebulaVolume({
  center, color, radius, opacity, drift, intensity,
}: {
  center: [number,number,number]; color: string; radius: number; opacity: number; drift: number; intensity: number
}) {
  const uniforms = useMemo(
    () => ({
      uTime:      { value: 0 },
      uColor:     { value: new THREE.Color(color) },
      uSunDir:    { value: SUN_DIR.clone() },
      uCenter:    { value: new THREE.Vector3(...center) },
      uRadius:    { value: radius },
      uOpacity:   { value: opacity * intensity },
      uDriftSeed: { value: drift },
    }),
    [color, radius, opacity, drift, center, intensity],
  )
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })
  return (
    <mesh position={center}>
      <sphereGeometry args={[radius, 24, 24]} />
      <shaderMaterial
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={NEBULA_VERTEX}
        fragmentShader={NEBULA_FRAGMENT}
      />
    </mesh>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────
// intensity=1.0 is the calibrated default.
// intensity=0.5 → nearly invisible haze (background-only use)
// intensity=1.5 → vivid bloom-feeding medium (full immersion)
// intensity=2.0 → push chromatic aberration + god-rays in PostFX to taste
export function AetherMedium({ intensity = 1.0 }: { intensity?: number }) {
  return (
    <group>
      {NEBULA_CONFIGS.map((n, i) => (
        <AetherNebulaVolume key={i} {...n} intensity={intensity} />
      ))}

      {SPRITE_CONFIGS.map((s, i) => (
        <AetherSprite key={i} position={s.position} color={s.color} scale={s.scale} driftSeed={s.drift} opacity={s.opacity * intensity} />
      ))}

      {STAR_LAYERS.map((l, i) => (
        <AetherStarLayer key={i} {...l} intensity={intensity} />
      ))}
    </group>
  )
}
