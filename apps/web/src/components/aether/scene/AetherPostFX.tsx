'use client'

import { useMemo } from 'react'
import {
  EffectComposer,
  Bloom,
  DepthOfField,
  ChromaticAberration,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

export function AetherPostFX() {
  const aberrationOffset = useMemo(() => new THREE.Vector2(0.0008, 0.0006), [])

  return (
    <EffectComposer multisampling={4}>
      <Bloom
        intensity={1.4}
        luminanceThreshold={0.28}
        luminanceSmoothing={0.4}
        radius={0.9}
        mipmapBlur
      />
      <DepthOfField
        focalLength={0.045}
        bokehScale={3.5}
        height={480}
        focusDistance={0.0}
      />
      <ChromaticAberration
        offset={aberrationOffset}
        blendFunction={BlendFunction.NORMAL}
        radialModulation={true}
        modulationOffset={0.55}
      />
      <Vignette eskil={false} offset={0.28} darkness={0.72} />
    </EffectComposer>
  )
}
