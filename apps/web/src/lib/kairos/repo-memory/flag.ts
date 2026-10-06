import { mindSwitch } from '@/lib/kairos/level'

// KAIROS_REPO_MEMORY: unset/'0' → off (nothing planned, no read); '1'/'on' →
// the nightly repo_lessons job keeps one lessons playbook per repo.
export type RepoMemoryMode = 'off' | 'on'

export function repoMemoryMode(): RepoMemoryMode {
  const raw = mindSwitch('KAIROS_REPO_MEMORY').trim().toLowerCase()
  return raw === '1' || raw === 'on' ? 'on' : 'off'
}
