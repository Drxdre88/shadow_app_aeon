'use client'

import {
  EffectComposer,
  Bloom,
  Vignette,
} from '@react-three/postprocessing'

// Bloom tuned to make the orb cores glow like the inspiration reference —
// threshold low enough that bright swirl centres trigger bloom, intensity
// strong enough to read as light sources, smoothing wide enough for that
// soft halo around each orb. Vignette stays for framing.
export function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        intensity={1.1}
        luminanceThreshold={0.32}
        luminanceSmoothing={0.35}
        radius={0.85}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.3} darkness={0.55} />
    </EffectComposer>
  )
}
