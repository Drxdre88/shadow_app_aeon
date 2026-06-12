'use client'

import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

// Wraps the loaded texture as a 360° environment around the camera. The image
// is treated as an equirectangular panorama (2:1 aspect ratio expected for a
// distortion-free wrap). Supports both LDR (.png/.jpg) and HDR (.hdr) sources —
// HDR carries true light values, so reflective materials get real highlights.
//
// With `environment`, the texture is also PMREM-processed and set as
// scene.environment so PBR materials reflect it. (We do this ourselves rather
// than drei's <Environment>, which rejects plain .png files.)
export function Backdrop({
  url = '/cortex/skybox-nebula-4k.png',
  environment = false,
}: {
  url?: string
  environment?: boolean
}) {
  const { scene, gl } = useThree()
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let disposed = false
    const isHdr = url.toLowerCase().endsWith('.hdr')

    const onLoad = (tex: THREE.Texture) => {
      if (disposed) {
        tex.dispose()
        return
      }
      tex.mapping = THREE.EquirectangularReflectionMapping
      tex.magFilter = THREE.LinearFilter
      tex.minFilter = THREE.LinearFilter
      tex.anisotropy = gl.capabilities.getMaxAnisotropy()
      tex.generateMipmaps = false
      // LDR is sRGB-encoded; HDR data is already linear — leave it untouched.
      if (!isHdr) tex.colorSpace = THREE.SRGBColorSpace
      setTexture(tex)
    }

    if (isHdr) {
      new RGBELoader().load(url, onLoad, undefined, () => {})
    } else {
      new THREE.TextureLoader().load(url, onLoad, undefined, () => {})
    }

    return () => {
      disposed = true
    }
  }, [url, gl])

  useEffect(() => {
    if (!texture) return
    const prevBg = scene.background
    const prevEnv = scene.environment
    scene.background = texture

    let envRT: THREE.WebGLRenderTarget | null = null
    if (environment) {
      const pmrem = new THREE.PMREMGenerator(gl)
      envRT = pmrem.fromEquirectangular(texture)
      scene.environment = envRT.texture
      pmrem.dispose()
    }

    return () => {
      scene.background = prevBg
      if (environment) scene.environment = prevEnv
      envRT?.dispose()
      texture.dispose()
    }
  }, [texture, environment, scene, gl])

  return null
}
