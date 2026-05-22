'use client'

import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import {
  PLANET_TEXTURES,
  NEBULA_BRUSHES,
  planetTextureUrl,
  nebulaBrushUrl,
  SKYBOX_URL,
  RINGS_URL,
  SPACESHIP_URL,
  type PlanetTextureName,
  type NebulaBrushName,
} from './cortexAssets'

// Load a texture into a Promise; resolves to null on 404 / decode failure so
// the scene can silently degrade.
function loadOptionalTexture(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      () => resolve(null)
    )
  })
}

type Bundle = {
  planets: Partial<Record<PlanetTextureName, THREE.Texture>>
  nebulae: Partial<Record<NebulaBrushName, THREE.Texture>>
  skybox: THREE.Texture | null
  rings: THREE.Texture | null
  spaceship: THREE.Texture | null
  ready: boolean
}

const EMPTY_BUNDLE: Bundle = {
  planets: {},
  nebulae: {},
  skybox: null,
  rings: null,
  spaceship: null,
  ready: false,
}

let cached: Bundle | null = null
let inflight: Promise<Bundle> | null = null

async function loadBundle(): Promise<Bundle> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    const planetEntries = await Promise.all(
      PLANET_TEXTURES.map(async (name) => [name, await loadOptionalTexture(planetTextureUrl(name))] as const)
    )
    const nebulaEntries = await Promise.all(
      NEBULA_BRUSHES.map(async (name) => [name, await loadOptionalTexture(nebulaBrushUrl(name))] as const)
    )
    const [skybox, rings, spaceship] = await Promise.all([
      loadOptionalTexture(SKYBOX_URL).then((t) => {
        if (t) {
          t.mapping = THREE.EquirectangularReflectionMapping
        }
        return t
      }),
      loadOptionalTexture(RINGS_URL),
      loadOptionalTexture(SPACESHIP_URL),
    ])
    const planets: Bundle['planets'] = {}
    for (const [name, tex] of planetEntries) if (tex) planets[name] = tex
    const nebulae: Bundle['nebulae'] = {}
    for (const [name, tex] of nebulaEntries) if (tex) nebulae[name] = tex
    cached = { planets, nebulae, skybox, rings, spaceship, ready: true }
    return cached
  })()
  return inflight
}

export function useCortexTextures(): Bundle {
  const [bundle, setBundle] = useState<Bundle>(cached ?? EMPTY_BUNDLE)
  useEffect(() => {
    let cancelled = false
    loadBundle().then((b) => {
      if (!cancelled) setBundle(b)
    })
    return () => { cancelled = true }
  }, [])
  return bundle
}

// Stable per-node texture lookup: same seed → same planet, even across the
// renderer churning through buildNodeMesh.
export function usePlanetPicker(bundle: Bundle): (seed: string | null | undefined) => THREE.Texture | null {
  return useMemo(() => {
    const ordered = PLANET_TEXTURES.filter((n) => bundle.planets[n])
    if (ordered.length === 0) return () => null
    return (seed) => {
      const key = seed && seed.length > 0 ? seed : 'default'
      let h = 2166136261
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i)
        h = (h * 16777619) >>> 0
      }
      return bundle.planets[ordered[h % ordered.length]] ?? null
    }
  }, [bundle.planets])
}
