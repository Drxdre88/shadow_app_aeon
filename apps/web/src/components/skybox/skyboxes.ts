// Shared skybox registry — used by both the Kairos and Aether scenes and the
// SkyboxDropdown. Single source of truth for ids, urls, labels, and the
// preview swatch shown in the picker. No React here, just data.

export type SkyboxId =
  | 'nebula-4k'
  | 'lunar-4k'
  | 'lunar-8k'
  | 'void-cathedral'
  | 'eye-of-the-dark-star'
  | 'starforge-remnant'
  | 'crystal-nebula'
  | 'dead-battlefield'
  | 'alien-orbit'

export interface SkyboxOption {
  id: SkyboxId
  label: string
  /** Public URL under /cortex. */
  url: string
  /** Loader hint — png is LDR (TextureLoader), hdr is HDR (RGBELoader). */
  format: 'png' | 'hdr'
  /** Short descriptor shown under the label in the dropdown. */
  hint: string
  /** CSS gradient preview swatch for the dropdown (no image fetch). */
  swatch: string
}

// HDR worlds are served from Cloudflare R2 (zero-egress) rather than committed
// to the repo — each is 18–25MB. Swap this base to a custom domain later and
// every HDR url follows. The PNG classics stay local under /cortex.
const R2_SKYBOX_BASE = 'https://pub-64ec0357916e464da9785adcf2427ba3.r2.dev/skybox_collection'

export const SKYBOXES: SkyboxOption[] = [
  {
    id: 'nebula-4k',
    label: 'Nebula',
    url: '/cortex/skybox-nebula-4k.png',
    format: 'png',
    hint: '4K · violet deep-field',
    swatch: 'radial-gradient(circle at 32% 30%, #7d4ad6 0%, #3a1d7a 45%, #0c0626 100%)',
  },
  {
    id: 'lunar-4k',
    label: 'Lunar',
    url: '/cortex/skybox-lunar-4k.png',
    format: 'png',
    hint: '4K · grey orbit',
    swatch: 'radial-gradient(circle at 32% 30%, #cdd6e4 0%, #6b7382 45%, #1a1e26 100%)',
  },
  {
    id: 'lunar-8k',
    label: 'Lunar XL',
    url: '/cortex/skybox-lunar-8k.png',
    format: 'png',
    hint: '8K · crisp orbit',
    swatch: 'radial-gradient(circle at 32% 30%, #e2e9f4 0%, #828b9c 45%, #20242e 100%)',
  },
  {
    id: 'void-cathedral',
    label: 'Void Cathedral',
    url: `${R2_SKYBOX_BASE}/void_cathedral.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #4a6fb0 0%, #1c2b52 45%, #03060e 100%)',
  },
  {
    id: 'eye-of-the-dark-star',
    label: 'Eye of the Dark Star',
    url: `${R2_SKYBOX_BASE}/eye_of_the_dark_star.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #d98a3a 0%, #6a2d12 42%, #0a0503 100%)',
  },
  {
    id: 'starforge-remnant',
    label: 'Starforge Remnant',
    url: `${R2_SKYBOX_BASE}/starforge_remnant.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #e0c071 0%, #7a4a2a 42%, #0c0604 100%)',
  },
  {
    id: 'crystal-nebula',
    label: 'Crystal Nebula',
    url: `${R2_SKYBOX_BASE}/crystal_nebula.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #5bd5d0 0%, #2a5a8a 45%, #060c14 100%)',
  },
  {
    id: 'dead-battlefield',
    label: 'Dead Battlefield',
    url: `${R2_SKYBOX_BASE}/dead_battlefield.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #9aa17c 0%, #4a4632 42%, #0a0a06 100%)',
  },
  {
    id: 'alien-orbit',
    label: 'Alien Orbit',
    url: `${R2_SKYBOX_BASE}/alien_orbit.hdr`,
    format: 'hdr',
    hint: 'HDR · reflective',
    swatch: 'radial-gradient(circle at 32% 30%, #6fe09a 0%, #2a6a52 42%, #04100a 100%)',
  },
]

export const SKYBOX_BY_ID: Record<SkyboxId, SkyboxOption> = Object.fromEntries(
  SKYBOXES.map((s) => [s.id, s]),
) as Record<SkyboxId, SkyboxOption>

export const KAIROS_DEFAULT_SKYBOX: SkyboxId = 'lunar-4k'
