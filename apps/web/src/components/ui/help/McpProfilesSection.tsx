'use client'

import { Section } from './shared'

const PROFILES = [
  { id: 'all', label: 'Everything (default)', covers: 'Every Aeon tool. Used when no profile is set, so existing connectors are unchanged.' },
  { id: 'board', label: 'Boards', covers: 'Projects, columns, cards, Gantt, labels, checklists, comments, dependencies, bulk setup, analytics, realms and virtual members.' },
  { id: 'vorath', label: 'Vorath', covers: 'Memory, Dominions, reflections, beliefs, constitution, dialogue, asks, thinking jobs and the daily Vorath tools. kairos works as an alias.' },
  { id: 'hangar', label: 'Hangar', covers: 'Hangar repo registry, agent sessions (including runner claims), realms, plus the cards and memory tools a mission runner reads: list and open cards, search and save memories.' },
] as const

export function McpProfilesSection() {
  return (
    <Section title="Tool Profiles">
      <div className="space-y-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          Add <span className="font-mono text-white">?profile=</span> to the MCP URL to give a connection a smaller,
          focused tool list. Fewer tools means faster, more accurate tool picks.
        </p>
        <div className="space-y-2">
          {PROFILES.map((p) => (
            <div key={p.id} className="text-xs">
              <p className="font-mono text-white">/api/mcp?profile={p.id}</p>
              <p className="text-slate-500">
                <span className="text-slate-300">{p.label}.</span> {p.covers}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Use it in the connector URL on claude.ai or in your client&apos;s config, e.g.{' '}
          <span className="font-mono text-slate-300">/api/mcp?profile=board</span>. Add one connector per profile if you
          want several. An unknown profile name is refused with the list of valid ones.
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          Tools that delete, remove, cancel or kill something ask you to confirm first in clients that support MCP confirmations
          (2026-07-28 protocol with elicitation), e.g. <span className="text-slate-300">Delete Task on board &quot;Roadmap&quot;? This
          can&apos;t be undone.</span> Saying no changes nothing. Older clients keep working as before, without the prompt.
        </p>
      </div>
    </Section>
  )
}
