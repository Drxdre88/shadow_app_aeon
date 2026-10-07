import Link from 'next/link'
import { ArrowLeft, Bot, BookOpen, CalendarClock, Handshake, HelpCircle, Hourglass, Sparkles } from 'lucide-react'
import type { MorningCockpit } from '@/lib/data/morning-cockpit'
import { CockpitCard, CockpitRow } from './CockpitCard'
import { VORATH_HREF, sessionHref, staleCardHref } from './links'

// The clickable morning view (P3-3): every row links to where it is acted on.
// It shows the sources, never the 06:00 message text itself.

const ICON = 'w-3.5 h-3.5'

function shortDay(value: string): string {
  const at = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(at.getTime())) return value
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
}

function clock(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

export function MorningCockpitView({ cockpit }: { cockpit: MorningCockpit }) {
  const c = cockpit
  return (
    <div className="h-full w-full overflow-y-auto">
      <header className="flex items-center gap-4 px-4 py-3 border-b border-white/[0.06] bg-black/40 backdrop-blur-md">
        <Link
          href={VORATH_HREF}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.2em] border bg-white/[0.02] text-white/40 hover:text-white/70 border-white/[0.06]"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>Vorath</span>
        </Link>
        <h1 className="text-[13px] font-medium text-white/85">Morning cockpit</h1>
        <span className="ml-auto text-[10px] text-white/35">
          {shortDay(c.today)} · overnight since {clock(c.since)} yesterday
        </span>
      </header>

      <div className="mx-auto max-w-5xl p-4 grid gap-4 md:grid-cols-2">
        <CockpitCard id="predictions" title="Predictions due" icon={<CalendarClock className={ICON} />} section={c.predictions} empty="Nothing due today." moreHref={VORATH_HREF}>
          {(p) => (
            <CockpitRow key={p.id} href={VORATH_HREF} tag={p.number} text={p.claim}
              detail={`${Math.round(p.probability * 100)}% · due ${shortDay(p.dueDate)}${p.needsVerdict ? ' · needs your verdict' : p.overdue ? ' · overdue' : ''}`} />
          )}
        </CockpitCard>

        <CockpitCard id="asks" title="Open questions" icon={<HelpCircle className={ICON} />} section={c.asks} empty="No questions waiting for you." moreHref={VORATH_HREF}>
          {(a) => (
            <CockpitRow key={a.id} href={VORATH_HREF} tag={a.number} text={a.question}
              detail={`asked ${shortDay(a.askedAt)}${a.expiresAt ? ` · closes ${shortDay(a.expiresAt)}` : ''}`} />
          )}
        </CockpitCard>

        <CockpitCard id="promises" title="Promises" icon={<Handshake className={ICON} />} section={c.promises} empty="No open promises." moreHref={VORATH_HREF}>
          {(p) => (
            <CockpitRow key={p.id} href={VORATH_HREF} tag={p.number} text={p.outcome}
              detail={`due ${shortDay(p.dueDate)}${p.overdue ? ' · overdue' : p.dueToday ? ' · today' : ''}`} />
          )}
        </CockpitCard>

        <CockpitCard id="proposals" title="Waiting for your decision" icon={<Sparkles className={ICON} />} section={c.proposals} empty="No proposals waiting." moreHref={VORATH_HREF}>
          {(p) => (
            <CockpitRow key={p.id} href={VORATH_HREF} tag={p.kind === 'goal' ? 'Goal' : 'Plan'} text={p.detail || p.title}
              detail={`${p.projectName ? `${p.projectName} · ` : ''}decide by ${shortDay(p.expiresAt)}`} />
          )}
        </CockpitCard>

        <CockpitCard id="stale" title="Stale cards" icon={<Hourglass className={ICON} />} section={c.staleCards} empty="No cards have gone quiet." moreHref="/dashboard">
          {(t) => (
            <CockpitRow key={t.taskId} href={staleCardHref(t)} text={t.name}
              detail={`${t.projectName}${t.columnName ? ` · ${t.columnName}` : ''} · untouched ${t.ageDays} days`} />
          )}
        </CockpitCard>

        <CockpitCard id="sessions" title="Overnight agent sessions" icon={<Bot className={ICON} />} section={c.sessions} empty="No agents ran overnight." moreHref={VORATH_HREF}>
          {(s) => (
            <CockpitRow key={s.id} href={sessionHref(s)} tag={s.engine} text={s.goal}
              detail={`${s.status}${s.repo ? ` · ${s.repo}` : ''} · started ${clock(s.spawnedAt)}`} />
          )}
        </CockpitCard>

        <CockpitCard id="lessons" title="Repos with new lessons" icon={<BookOpen className={ICON} />} section={c.repoLessons} empty="No new lessons since yesterday." moreHref={VORATH_HREF}>
          {(r) => (
            <CockpitRow key={r.id} href={VORATH_HREF} tag={r.slug} text={r.topLesson ?? `${r.lessonCount} lessons`}
              detail={`${r.lessonCount} lesson${r.lessonCount === 1 ? '' : 's'} · updated ${clock(r.updatedAt)}`} />
          )}
        </CockpitCard>
      </div>
    </div>
  )
}
