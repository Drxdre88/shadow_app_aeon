'use client'

import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Wraps the loaded texture as a 360° environment around the camera. The image
// is treated as an equirectangular panorama (2:1 aspect ratio expected for a
// distortion-free wrap). Non-2:1 images will warp at the poles but still
// surround the camera as you orbit.
export function Backdrop({ url = '/cortex/skybox.png' }: { url?: string }) {
  const { scene, gl } = useThree()
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
        tex.mapping = THREE.EquirectangularReflectionMapping
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearFilter
        tex.anisotropy = gl.capabilities.getMaxAnisotropy()
        tex.generateMipmaps = false
        setTexture(tex)
      },
      undefined,
      () => {
        // Silent miss — scene falls back to canvas style background.
      },
    )
    return () => {
      disposed = true
    }
  }, [url, gl])

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
