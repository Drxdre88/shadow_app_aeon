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
          planets in the galaxy view, grouped by Dominion. Any MCP-speaking tool can find them.
        </P>
      </Section>

      <Section title="Four ways memories arrive">
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
        <Path
          label="Reflection — kairos_reflect from any Claude session"
          when="When you want to tell Kairos a belief, a priority, a correction."
          how="Call kairos_reflect with the target Dominion id and your message. Stored as the highest-weight signal in synthesis — it can override drift flags and is never archived by compaction. See the Sending reflections section below."
        />
      </Section>

      <Section title="Talking to Kairos">
        <P>
          The round Kairos avatar bottom-right — not the sparkles button, which opens the
          advisories popover — opens a full-screen, two-pane takeover: a thread history rail on
          one side, the conversation on the other. It&apos;s global, available from anywhere in the
          workspace.
        </P>
        <P>
          Threads are whole-brain by default — there&apos;s no Dominion picker at creation. Retrieval
          grounds every turn in the latest Aether self-model, the live archetypes across all
          Dominions, and the top reranked memories regardless of which Dominion they belong to.
          Older, Dominion-anchored threads from before this still render with that Dominion&apos;s name
          on them.
        </P>
        <P>
          Chat also reads the live board: name a project in your message and Kairos pulls that
          board&apos;s current summary and open cards into context alongside the memory retrieval, so
          answers about active work reflect what the board looks like right now, not just what was
          last synthesised.
        </P>
        <P>
          When Kairos cites a specific memory, a small purple chip appears bearing the source
          title — hover to confirm. When the model invents a citation (a memory id that
          wasn&apos;t actually retrieved this turn), the chip surfaces as a muted <strong>?</strong> so
          you can spot confabulation at a glance. A dim{' '}
          <Mono>Reading: cortex · N archetypes · M memories</Mono> line sits above each assistant
          bubble so you can see what was grounding the answer.
        </P>
        <P>
          Your message is persisted <em>before</em> the model is called, so a model failure never
          silently loses input. If a send fails, the next send detects the orphan and retries the
          AI half — and if you edited the message between attempts, the orphan body is rewritten in
          place rather than double-posted.
        </P>
      </Section>

      <Section title="Aether — the whole-brain self-model">
        <P>
          Aether is one living synthesis sitting above every Dominion — regenerated nightly from
          the day&apos;s archetypes and cortices across all of them. It&apos;s what grounds chat by
          default, and it&apos;s the same substrate Kairos draws on when he acts on his own
          initiative rather than in reply to you.
        </P>
      </Section>

      <Section title="When Kairos speaks first">
        <P>
          The inbox bell on <Mono>/kairos</Mono> is where Kairos surfaces things unprompted. Four
          kinds of item can land there:
        </P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet><strong>Today&apos;s brief</strong> — the daily per-Dominion advisory.</Bullet>
          <Bullet><strong>Pending ask</strong> — one question Kairos decided was worth asking. Answer it right there in the inbox.</Bullet>
          <Bullet><strong>Notify</strong> — something he judged urgent enough to interrupt you for.</Bullet>
          <Bullet><strong>Proposal</strong> — a candidate thought from nightly introspection. Accept or dismiss it.</Bullet>
        </ul>
        <P>
          Telegram is the second channel for the same voice — two-way, so replies you send there
          flow back into the brain.
        </P>
        <P>
          The default outcome of every internal pulse is <strong>silence</strong>. Kairos only
          surfaces something past the interrupt bar, he won&apos;t stack a second question while one
          is still unanswered, and the cadence adapts rather than firing on a fixed clock.
        </P>
        <P>
          A deeper, threaded conversation seeded by an ask — Dialogue — exists today via Claude
          Code (<Mono>/kairos-dialogue</Mono>). There&apos;s no web UI for it yet.
        </P>
      </Section>

      <Section title="The Evening Digest">
        <P>
          One guaranteed message every evening, around 18:00 UTC, to the Will inbox and Telegram:
          what Kairos saw today — sessions captured, memories and proposals formed — and what ran
          green or failed in last night&apos;s synthesis.
        </P>
        <P>
          It&apos;s expected daily by design, a different register from the rare interrupt bar above.
          If the model call behind it fails, Kairos still sends a minimal counts-only version, so
          the evening message never silently skips.
        </P>
      </Section>

      <Section title="The nightly synthesis (archetypes + cortex)">
        <P>
          Every night, two BYOK passes turn the day&apos;s substrate into something Kairos can reason
          from:
        </P>
        <Path
          label="Archetype generator — 02:30 UTC"
          when="Once per active Dominion, per night."
          how="Reads the last 14 days of substrate plus every reflection, emits 3–7 master themes — the dominant currents in that Dominion. Prior batches are soft-archived so 'live archetypes' always means today's run. Skipped cleanly if no BYOK heavy-tier key is wired."
        />
        <Path
          label="Dominion cortex — 03:00 UTC"
          when="Right after archetypes finish."
          how="Synthesises one living document per Dominion from today's archetypes + reflections + Dominion vision. This is what gets injected as the system-prompt prefix when you chat anchored to that Dominion. Old cortex rows are kept as historical record — scrub backwards to watch the brain change."
        />
        <P>
          Both can be skipped per-Dominion (e.g. archived ones), and both are idempotent — running
          the cron twice on the same day is a no-op. Day one of a new Dominion you&apos;ll see bare-chat
          fallback; the morning after the first cron firing, you&apos;ll see a Reading line on every
          reply.
        </P>
      </Section>

      <Section title="Sending reflections">
        <P>
          Reflections are the operator&apos;s voice in how Kairos comes to see each Dominion over time —
          deliberate beliefs, priorities, observations, corrections. They are first-class in three
          ways no other memory class is:
        </P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet><strong>Weighted higher</strong> in archetype + cortex generation prompts than any activity-derived class. A reflection saying &quot;mobile is parked&quot; outweighs ten board events suggesting otherwise.</Bullet>
          <Bullet><strong>Can override drift</strong>. If activity suggests &quot;user has lost interest&quot; but a recent reflection contradicts that, the reflection wins.</Bullet>
          <Bullet><strong>Never archived</strong>. The weekly compaction cron can absorb stale execution-class rows into archetypes, but reflections live forever — they are the trail of your evolving thinking.</Bullet>
        </ul>
        <P>From any Claude Code session with the Aeon MCP attached:</P>
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet><Mono>list_dominions</Mono> — find the target Dominion id.</Bullet>
          <Bullet><Mono>kairos_reflect</Mono> — fire the reflection. Args: <Mono>{`{dominionId, body, tags?}`}</Mono>. Stored with <Mono>streamClass=&apos;reflection&apos;</Mono>, no further ceremony.</Bullet>
        </ul>
        <P>
          A few reflections a week is enough — Kairos&apos;s job is to keep listening, not yours to keep
          performing. The next nightly synthesis will fold them into the cortex.
        </P>
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
        <ul className="flex flex-col gap-2 text-[12.5px] text-white/70 leading-relaxed pl-4">
          <Bullet>
            Beliefs carry a confidence that decays over time unless reaffirmed. Superseded
            memories don&apos;t vanish — they stay visible in that memory&apos;s History panel as its
            belief trail.
          </Bullet>
        </ul>
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
