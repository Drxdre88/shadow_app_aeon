export const MCP_PROFILES = ['all', 'board', 'vorath', 'hangar'] as const

export type McpProfile = (typeof MCP_PROFILES)[number]

export type SlimProfile = Exclude<McpProfile, 'all'>

const PROFILE_ALIASES: Record<string, McpProfile> = { kairos: 'vorath' }

export function parseProfile(url: URL): McpProfile | null {
  const raw = url.searchParams.get('profile')?.trim().toLowerCase()
  if (!raw) return 'all'
  const name = PROFILE_ALIASES[raw] ?? raw
  return (MCP_PROFILES as readonly string[]).includes(name) ? (name as McpProfile) : null
}

export function profileGate(profile: McpProfile): (...groups: SlimProfile[]) => boolean {
  return (...groups) => profile === 'all' || (groups as McpProfile[]).includes(profile)
}
