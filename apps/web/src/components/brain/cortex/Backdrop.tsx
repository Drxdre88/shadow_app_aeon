'use client'

import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Flat painted backdrop. Loads via THREE.TextureLoader imperatively (NOT
// useLoader) so a missing/slow image doesn't suspend the whole Canvas tree
// and freeze the renderer at white. Sets the loaded texture as scene.background;
// three.js stretches it across the viewport regardless of camera orientation.
export function Backdrop({ url = '/cortex/skybox.png' }: { url?: string }) {
  const { scene } = useThree()
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        setTexture(tex)
      },
      undefined,
      () => {
        // Silent miss — the scene still renders against the canvas style background.
      },
    )
    return () => {
      disposed = true
    }
  }, [url])

  useEffect(() => {
    if (!texture) return
    const previous = scene.background
    scene.background = texture
    return () => {
      scene.background = previous
    }
  }, [texture, scene])

  return null
}
