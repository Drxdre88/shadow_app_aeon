// Manifest + helpers for the Cortex 3D scene assets.
// All files live under apps/web/public/cortex/ and are loaded by URL.
// If a file is missing the loader returns null and the renderer falls back
// to a procedural emissive sphere — so the scene degrades gracefully while
// the user is still generating assets.

export const CORTEX_ASSET_ROOT = '/cortex'

export const PLANET_TEXTURES = [
  'planet_jupiter',
  'planet_earth',
  'planet_mars',
  'planet_neptune',
  'planet_violet',
  'planet_plasma',
  'planet_lava',
  'planet_emerald',
] as const

export type PlanetTextureName = (typeof PLANET_TEXTURES)[number]

export const NEBULA_BRUSHES = [
  'nebula_violet',
  'nebula_cyan',
  'nebula_amber',
  'nebula_rose',
] as const

export type NebulaBrushName = (typeof NEBULA_BRUSHES)[number]

export function planetTextureUrl(name: PlanetTextureName): string {
  return `${CORTEX_ASSET_ROOT}/planets/${name}.png`
}

export function nebulaBrushUrl(name: NebulaBrushName): string {
  return `${CORTEX_ASSET_ROOT}/nebulae/${name}.png`
}

export const RINGS_URL = `${CORTEX_ASSET_ROOT}/rings_saturn.png`
export const SPACESHIP_URL = `${CORTEX_ASSET_ROOT}/spaceship.png`

// Stable hash → planet picker so the same realmId / repo always lands on
// the same texture. Falls back to source/type if neither is set.
function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return h
}

export function pickPlanetTexture(seed: string | null | undefined): PlanetTextureName {
  const key = seed && seed.length > 0 ? seed : 'default'
  return PLANET_TEXTURES[hashString(key) % PLANET_TEXTURES.length]
}
