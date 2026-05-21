'use client'

import { useMemo } from 'react'
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
} from '@react-three/postprocessing'
import * as THREE from 'three'
import { RadialBlur } from './RadialBlur'

export function PostFX() {
  const aberrationOffset = useMemo(() => new THREE.Vector2(0.0008, 0.0006), [])
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={1.4}
        luminanceThreshold={0.18}
        luminanceSmoothing={0.25}
        radius={0.88}
        mipmapBlur
      />
      <RadialBlur strength={0.04} />
      <ChromaticAberration offset={aberrationOffset} radialModulation={false} modulationOffset={0} />
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>
  )
}
