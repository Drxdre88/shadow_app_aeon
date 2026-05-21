'use client'

import {
  EffectComposer,
  Bloom,
  Vignette,
} from '@react-three/postprocessing'

// Lean post-processing — bloom only on bright planet emission, plus a vignette
// for framing. Chromatic aberration and radial blur removed because they
// smear the painted backdrop and make everything read as soft / blurry.
export function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        intensity={0.65}
        luminanceThreshold={0.5}
        luminanceSmoothing={0.2}
        radius={0.7}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.3} darkness={0.6} />
    </EffectComposer>
  )
}
