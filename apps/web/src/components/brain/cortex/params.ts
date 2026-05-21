import * as THREE from 'three'

export const SUN_DIR = new THREE.Vector3(0.4, 0.6, 0.8).normalize()

export type PlanetArchetype = 'gas-giant' | 'terrestrial' | 'icy'

export function archetypeFromSeed(seed: string | null | undefined): PlanetArchetype {
  if (!seed) return 'icy'
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const archetypes: PlanetArchetype[] = ['gas-giant', 'terrestrial', 'icy']
  return archetypes[h % 3]
}
