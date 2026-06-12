'use client'

import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'

// Prototype post-FX diet. With a static equirect skybox:
//   – DepthOfField removed: the skybox sits at the far plane, so DoF would
//     blur the whole nebula to mush (and bokeh is fullscreen-expensive).
//   – ChromaticAberration removed: cheap visually, but reads as smear over a
//     detailed photographic background.
//   – multisampling 0: MSAA on the HDR buffer buys nothing here; bloom hides edges.
//   – Bloom threshold raised (0.28 → 0.62) so only the hot orb cores bloom,
//     instead of washing the whole skybox.
export function AetherPostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.7}
        luminanceThreshold={0.78}
        luminanceSmoothing={0.3}
        radius={0.7}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.28} darkness={0.72} />
    </EffectComposer>
  )
}
