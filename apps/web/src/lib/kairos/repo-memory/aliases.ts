import { normalizeRepoSlug } from '@/lib/kairos/living/repo-slug'

// Board labels `repo:<label>` ↔ repo folder slugs. Either form resolves to
// the folder slug plus every board label that points at it.

const LABEL_TO_SLUG: Readonly<Record<string, string>> = {
  aeon: 'shadow_app_aeon',
  kairos: 'shadow_app_aeon',
  swarm: 'shadow_app_swarm',
  hydra: 'shadow_app_hydra',
  visor: 'shadow_app_visor',
  arq: 'shadow_app_arq',
  'shadow-data': 'shadow_data_lab',
  'shadow-dev': 'shadow_dev_lab',
  'shadow-dag': 'shadow_dag_lab',
  'arcane-dag': 'arcane_dag_lab',
  'kal-el': 'kal_el_dash',
  vulcan: 'shadow_app_vulcan',
  antares: 'shadow_app_antares',
  ermac: 'stp_app_ermac',
  rift: 'shadow_app_rift',
  triad: 'shadow_app_triad',
  relic: 'stp_app_relic',
  wraith: 'shadow_app_wraith',
  hyperion: 'shadow_dev_lab',
}

export interface ResolvedRepo {
  slug: string
  labels: string[]
}

export function labelsForSlug(slug: string): string[] {
  return Object.entries(LABEL_TO_SLUG).filter(([, s]) => s === slug).map(([label]) => label)
}

// Accepts 'aeon', 'repo:aeon', 'shadow_app_aeon' or a path ending in the
// folder; an unknown name resolves to itself as both slug and label.
export function resolveRepo(input: string): ResolvedRepo | null {
  const raw = input.trim().toLowerCase().replace(/^repo:/, '').trim()
  if (!raw) return null
  const viaLabel = LABEL_TO_SLUG[raw]
  if (viaLabel) return { slug: viaLabel, labels: labelsForSlug(viaLabel) }
  const slug = normalizeRepoSlug(raw)
  if (!slug) return null
  const viaLastSegment = LABEL_TO_SLUG[slug]
  if (viaLastSegment) return { slug: viaLastSegment, labels: labelsForSlug(viaLastSegment) }
  const labels = labelsForSlug(slug)
  return { slug, labels: labels.length ? labels : [slug] }
}

export function repoLabelNames(repo: ResolvedRepo): string[] {
  return repo.labels.map((l) => `repo:${l}`)
}
