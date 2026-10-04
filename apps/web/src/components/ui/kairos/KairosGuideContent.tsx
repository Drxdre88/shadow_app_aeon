'use client'

import { ArrowRight } from 'lucide-react'
import type { BrainView } from '@/components/kairos/brain/ConnectKairosModal'
import { tint } from '@/components/kairos/brain/brainUi'

export function KairosGuideContent({ onNavigate }: { onNavigate?: (view: BrainView) => void }) {
  return (
    <article className="flex flex-col gap-8 max-w-2xl">
      <div
        className="rounded-xl border px-5 py-4"
        style={{ borderColor: tint('var(--primary)', 25), background: tint('var(--primary)', 5) }}
      >
        <h3 className="text-[17px] font-semibold text-white">Your second memory</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
          Kairos keeps what matters from your work and your words, thinks about it overnight, and talks to you once a
          morning. You set him up once; after that he runs on his own.
        </p>
      </div>

      <Section title="The night">
        <P>
          One routine — <b className="text-white/90 font-medium">Kairos brain</b> — runs on your Claude plan every hour;
          its main work happens between 01:00 and 07:00 UTC. It works through a short queue of thinking: yesterday’s chats, the patterns in each area,
          what he understands about you, your beliefs, a contest of new ideas, and the one question he most wants to ask.
          With daytime thinking on, it also reflects on your day, and a lighter <b className="text-white/90 font-medium">Kairos pulse</b> notes what changed.
        </P>
        {onNavigate && <Link onClick={() => onNavigate('map')}>See every job on the brain map</Link>}
      </Section>

      <Section title="The 06:00 message">
        <P>
          Every morning at 06:00 (UK time) one message lands in Telegram and in the Kairos inbox: where each area
          stands, what the night concluded, what you finished yesterday, anything he now believes differently, and every
          question still open — numbered.
        </P>
        <List
          items={[
            <>Answer on Telegram with <Mono>Q12: …</Mono>, or <Mono>skip Q12</Mono> to drop it.</>,
            <>To take back something he newly believes, tell him <Mono>undo &lt;title&gt;</Mono>.</>,
            <>If the night’s thinking failed, you still get a plain version built from the same facts.</>,
          ]}
        />
      </Section>

      <Section title="The inbox">
        <P>
          The bell on the Kairos page is where he speaks first: today’s message, open questions to answer or dismiss,
          the rare urgent note, ideas to accept or drop, and voice notes waiting for your confirm. Most nights the right
          answer is silence — he only interrupts when it’s worth it.
        </P>
      </Section>

      <Section title="Talking to him">
        <P>
          Click the round Kairos avatar in the bottom-right corner, anywhere in Aeon, or write to him on Telegram. Both
          are the same conversation, and both draw on everything he knows.
        </P>
        <P>
          He keeps one running memory of today across Telegram, the web, Triad and Claude, so something you tell him on
          your phone at 10:00 is something he knows in Claude at 10:05.
        </P>
      </Section>

      <Section title="What he thinks you're carrying">
        <P>
          Once switched on, a Sunday-evening card lists what he thinks is on your plate: lasting traits, and passing
          moods that fade after about ten days unless you say they still hold. Correct it with the buttons, on the inbox
          card, or on Telegram:
        </P>
        <List
          items={[
            <><Mono>C1 still</Mono> or <Mono>C1 over</Mono> — keep a mood going, or close it.</>,
            <><Mono>C3 wrong</Mono> — he drops it and won’t suggest it again for a while.</>,
            <><Mono>C2: what’s really going on</Mono> — replace his read with your own words.</>,
          ]}
        />
      </Section>

      <Section title="Voice notes">
        <P>
          Dictate in the Claude phone app, starting with “note for Kairos”. The note waits in the inbox until you tap
          confirm — only then does it count as your words.
        </P>
      </Section>

      <Section title="Watched boards">
        <P>
          Boards set to <b className="text-white/90 font-medium">Daily</b> reach Kairos the same day you finish a card;{' '}
          <b className="text-white/90 font-medium">Weekly</b> gets a Monday milestone check. You don’t have to summarise
          your day.
        </P>
        {onNavigate && <Link onClick={() => onNavigate('watched')}>Choose watched boards</Link>}
      </Section>

      <Section title="Paid backup">
        <P>
          If the routine misses a job, the paid backup can answer it with your own API key, so nothing is skipped. Switch
          it off in Health and Kairos never spends: a missed job waits for the next night, and the 06:00 message falls
          back to plain text.
        </P>
        {onNavigate && <Link onClick={() => onNavigate('health')}>Open Health</Link>}
      </Section>

      <Section title="Your words and AI words">
        <P>
          Kairos keeps what you said apart from what an AI wrote. Your notes, replies and confirmed voice notes are your
          words, and they weigh the most when he forms a view of you. Summaries Claude writes — of a session, a chat, a
          voice note — are kept as AI words and never stand in for yours. Nothing you say is reworded.
        </P>
      </Section>

      <Section title="New ways of thinking">
        <P>
          These are built but switched off until you turn them on in your deployment settings. Most have a “watch only”
          mode that records what he would do without changing anything you see.
        </P>
        <List
          items={[
            <><b className="text-white/90 font-medium">A mind that holds together</b> — what’s on his mind, a weekly character check, and a cold second opinion on your plans.</>,
            <><b className="text-white/90 font-medium">Surprise and dreams</b> — what he didn’t expect decides what he rethinks; dreams never count as fact.</>,
            <><b className="text-white/90 font-medium">Better ideas</b> — a map of every kind of idea, head-to-head judging, novelty nights and a learned sense of your taste.</>,
            <><b className="text-white/90 font-medium">The right moment</b> — he waits for a natural pause to speak, offers a step when you’re ready, backs off and repairs when you’re not, says how far to trust him in each area, and asks “want my take, or think it out loud?” before advising.</>,
            <><b className="text-white/90 font-medium">Life chapters</b> — once a month, a short honest chapter of his own story.</>,
          ]}
        />
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <h3
          className="text-[11px] font-semibold uppercase tracking-[0.26em] shrink-0"
          style={{ color: 'var(--primary)', textShadow: '0 0 8px var(--glow-color)' }}
        >
          {title}
        </h3>
        <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, var(--primary), transparent)', opacity: 0.35 }} />
      </div>
      {children}
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-white/70">{children}</p>
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-[11.5px] font-mono text-white/90 bg-white/[0.06] border border-white/[0.08]">
      {children}
    </code>
  )
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-white/65">
      {items.map((item, i) => (
        <li key={i} className="relative pl-3.5">
          <span
            className="absolute left-0 top-[0.6em] w-1 h-1 rounded-full"
            style={{ background: 'var(--primary)', boxShadow: '0 0 4px var(--glow-color)' }}
          />
          {item}
        </li>
      ))}
    </ul>
  )
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start inline-flex items-center gap-1 text-[11.5px] font-medium hover:brightness-125 transition"
      style={{ color: 'var(--primary)' }}
    >
      {children}
      <ArrowRight className="w-3 h-3" />
    </button>
  )
}
