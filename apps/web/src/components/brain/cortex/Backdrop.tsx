'use client'

import { useEffect } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Flat painted backdrop. Sets the loaded texture as scene.background — three.js
// stretches it across the viewport regardless of camera orientation. NOT a true
// equirectangular skybox (the current image is a focal painting, not a 360°
// panorama). Foreground 3D planets float in front of it; orbiting the camera
// does not parallax against this layer, but the painted detail reads cleanly.
export function Backdrop({ url = '/cortex/skybox.png' }: { url?: string }) {
  const texture = useLoader(THREE.TextureLoader, url)
  const { scene } = useThree()

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    const previous = scene.background
    scene.background = texture
    return () => {
      scene.background = previous
    }
  }, [texture, scene])

  return null
}
