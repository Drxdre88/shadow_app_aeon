'use client'

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

type Props = {
  url: string
  camRef: React.MutableRefObject<{ x: number; y: number; zoom: number }>
}

export function Backdrop2D({ url, camRef }: Props) {
  const { gl, size } = useThree()
  const meshRef = useRef<THREE.Mesh>(null)
  const texAspect = useRef(1)

  useEffect(() => {
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        if (disposed) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearFilter
        tex.anisotropy = gl.capabilities.getMaxAnisotropy()
        tex.generateMipmaps = false
        texAspect.current = tex.image.naturalWidth / tex.image.naturalHeight
        if (meshRef.current) {
          const mat = meshRef.current.material as THREE.MeshBasicMaterial
          mat.map = tex
          mat.needsUpdate = true
        }
      },
      undefined,
      () => {},
    )
    return () => { disposed = true }
  }, [url, gl])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const zoom = camRef.current.zoom
    const hw = (size.width / 2) / zoom
    const hh = (size.height / 2) / zoom
    const screenAspect = size.width / size.height
    let pw: number, ph: number
    if (screenAspect > texAspect.current) {
      pw = hw * 2 * 1.4
      ph = pw / texAspect.current
    } else {
      ph = hh * 2 * 1.4
      pw = ph * texAspect.current
    }
    mesh.scale.set(pw, ph, 1)
    // Parallax: backdrop pans at 18% of camera pan so it reads as distant scenery.
    const px = camRef.current.x * 0.18
    const py = camRef.current.y * 0.18
    mesh.position.set(px, py, -500)
  })

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}
