'use client'

import { cn } from '@/lib/utils/cn'

export function KairosGuideContent() {
  return (
    <article className="flex flex-col gap-10 text-white/85 max-w-3xl">
      <Hero />

      <Section title="What Kairos is">
        <P>
          A personal memory layer for the things worth remembering. Every thought, decision,
          observation, or coding session lives here as a structured memory — anchored to a
          project, realm, or Dominion, and linked to the ideas it relates to. You see them as
          planets in the 2D/3D view, grouped by Dominion. Any MCP-speaking tool can find them.
        </P>
      </Section>

      <Section title="Three ways memories arrive">
        <Path
          label="Automatic — Claude session capture"
          when="When a Claude Code session ends."
          how="A hook reads the whole transcript, grabs the git context (repo, branch, files, commits), optionally asks Claude to write a clean title and 5–10 bullet summary, then posts one memory."
        />
        <Path
          label="Automatic — session backfill"
          when="On the next session start, if anything was missed."
          how="The same script runs with --backfill and sweeps the last 48 hours. Sessions already saved are skipped — no duplicates."
        />
        <Path
          label="Manual — MCP tools and sidebar capture"
          when="On demand, any time."
          how="Call create_memory from any chat, or hit Note / EOD reflect in the sidebar. The caller writes the clean title and bullets — the server never calls an LLM on the way in."
        />
      </Section>

      <Section title="The summarisation model">
        <P>
          The server is dumb on writes — it stores exactly what you send. Summarisation happens
          wherever the call originates from:
        </P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet>
            <strong>Session captures:</strong> the hook calls <Mono>claude --print</Mono> with the
            transcript and slots the returned <Mono>aiTitle</Mono> + <Mono>execSummary</Mono> into
            the payload.
          </Bullet>
          <Bullet>
            <strong>Manual captures:</strong> whichever agent is composing the message writes the
            cleanup before calling the MCP tool. Both fields are first-class on the tool.
          </Bullet>
          <Bullet>
            <strong>UI:</strong> shows the AI-cleaned title when it exists, the raw title
            otherwise. The bullet summary is the headline on the memory side panel.
          </Bullet>
        </ul>
      </Section>

      <Section title="How memories are classified">
        <P>
          Every memory carries two labels plus its anchors. The labels are fixed; how you combine
          them is up to you.
        </P>
        <ClassGrid
          title="Type"
          subtitle="What kind of thought it is"
          items={[
            ['note', 'Default — generic capture'],
            ['decision', 'Something resolved: we chose X because Y'],
            ['idea', 'Speculative, not yet committed'],
            ['observation', 'A neutral fact about the world or system'],
            ['session_summary', 'Auto-captured Claude session'],
            ['reflection', 'EOD or retrospective'],
          ]}
        />
        <ClassGrid
          title="Source"
          subtitle="Where it came from"
          items={[
            ['manual', 'You typed it'],
            ['claude', 'Captured via session hook or chat'],
            ['voice', 'Speech-to-text dictation'],
            ['hook', 'Some other automated import'],
            ['import', 'Bulk loaded'],
          ]}
        />
      </Section>

      <Section title="Anchoring and grouping">
        <P>
          Memories live in your private pool and can optionally anchor to higher things. Whichever
          colour mode you pick in Kairos decides which anchor draws the clusters.
        </P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet><strong>Dominion</strong> — top-level grouping. Owns projects and repos. The recommended default colour mode.</Bullet>
          <Bullet><strong>Realm</strong> — workspace boundary, shared with collaborators (for now: you).</Bullet>
          <Bullet><strong>Project</strong> — Aeon board this memory relates to.</Bullet>
          <Bullet><strong>Task</strong> — specific board card the memory is about.</Bullet>
          <Bullet><strong>Tags</strong> — free-form labels for cross-cutting themes.</Bullet>
        </ul>
        <P>
          When a memory has no Dominion of its own, Kairos walks the chain:{' '}
          <Mono>memory.dominionId</Mono>, then its project’s Dominion, then a Dominion that owns
          the repo. Runs automatically on every create.
        </P>
      </Section>

      <Section title="Querying the brain">
        <P>From any Claude session with the Aeon MCP attached, four read tools cover the basics:</P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet><Mono>search_memories</Mono> — BM25 full-text over title, summary, body. Filter by type, source, realm, project, tags.</Bullet>
          <Bullet><Mono>get_memory_with_neighbours</Mono> — pull a memory plus its typed edges, 1–2 hops out.</Bullet>
          <Bullet><Mono>prepare_context</Mono> — budget-aware context pack ready to drop into another conversation.</Bullet>
          <Bullet><Mono>list_dominions</Mono>, <Mono>list_projects</Mono> — navigate the grouping hierarchy.</Bullet>
        </ul>
      </Section>

      <Section title="The two-layer safety net">
        <P>You almost never lose a session. Here’s why:</P>
        <div className="rounded-xl border border-white/[0.08] bg-black/30 p-5 font-mono text-[11.5px] leading-relaxed text-white/75 whitespace-pre overflow-x-auto">
{`Claude session ends
  │
  ├─ clean exit (/exit, close terminal, kill button)
  │     └─ SessionEnd hook fires
  │           └─ POST /api/v1/memories          → stored
  │
  └─ hard kill, crash, BSOD, force-quit
        └─ SessionEnd missed
              │
              ▼ next time you launch Claude
        SessionStart hook fires with --backfill
              └─ scans transcripts from last 48h
                    └─ POST each, server dedupes  → stored`}
        </div>
        <P>
          Only realistic way to lose a session: hard-kill followed by no Claude for more than 48
          hours. Widen the window with <Mono>BRAIN_BACKFILL_HOURS</Mono> if that worries you.
        </P>
      </Section>
    </article>
  )
}

function Hero() {
  return (
    <div className="rounded-2xl border border-white/[0.10] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6">
      <div
        className="inline-block text-[10px] font-medium uppercase tracking-[0.32em] px-3 py-1 rounded-full mb-3"
        style={{
          color: 'var(--primary)',
          border: '1px solid var(--primary)',
          textShadow: '0 0 6px var(--glow-color)',
          background: 'rgba(8,6,18,0.4)',
        }}
      >
        Your second memory
      </div>
      <h2 className="text-2xl font-semibold text-white mb-2">Where your thinking goes when you’re done thinking it</h2>
      <p className="text-[13.5px] text-white/65 leading-relaxed max-w-2xl">
        Kairos quietly absorbs the work you do — coding sessions, decisions, ideas, end-of-day
        reflections. Each one becomes a memory with a clean summary, grouped by Dominion. Any tool
        that speaks MCP can find it again later.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="h-px flex-1 max-w-[24px]"
          style={{ background: 'linear-gradient(90deg, transparent, var(--primary))', opacity: 0.45 }}
        />
        <h3
          className="text-[11px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: 'var(--primary)', textShadow: '0 0 8px var(--glow-color)' }}
        >
          {title}
        </h3>
        <div
          className="h-px flex-1"
          style={{ background: 'linear-gradient(90deg, var(--primary), transparent)', opacity: 0.45 }}
        />
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-white/72">{children}</p>
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-[11.5px] font-mono text-white/90 bg-white/[0.06] border border-white/[0.08]">
      {children}
    </code>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-3">
      <span
        className="absolute left-0 top-[0.55em] w-1 h-1 rounded-full"
        style={{ background: 'var(--primary)', boxShadow: '0 0 4px var(--glow-color)' }}
      />
      {children}
    </li>
  )
}

function Path({ label, when, how }: { label: string; when: string; how: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--primary)', boxShadow: '0 0 6px var(--glow-color)' }}
        />
        <h4 className="text-[13px] font-semibold text-white">{label}</h4>
      </div>
      <div className="grid grid-cols-[80px_1fr] gap-2 text-[12px]">
        <div className="text-white/40 uppercase tracking-[0.16em] text-[10px] pt-0.5">When</div>
        <div className="text-white/70 leading-relaxed">{when}</div>
        <div className="text-white/40 uppercase tracking-[0.16em] text-[10px] pt-0.5">How</div>
        <div className="text-white/70 leading-relaxed">{how}</div>
      </div>
    </div>
  )
}

function ClassGrid({
  title, subtitle, items,
}: { title: string; subtitle: string; items: [string, string][] }) {
  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden">
      <div className="flex items-baseline gap-3 px-4 py-2.5 bg-white/[0.04] border-b border-white/[0.06]">
        <span className="text-[12px] font-semibold text-white/90">{title}</span>
        <span className="text-[10.5px] text-white/45">{subtitle}</span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {items.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              'grid grid-cols-[160px_1fr] gap-3 px-4 py-2 text-[12px]',
              i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]',
            )}
          >
            <div className="font-mono text-white/85">{k}</div>
            <div className="text-white/65">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
