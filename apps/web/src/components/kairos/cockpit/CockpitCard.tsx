import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CockpitSection } from '@/lib/data/morning-cockpit'

// One calm card per cockpit section: title + count, up to eight linked rows,
// an "and N more" tail, and a plain-words empty state.

export function CockpitCard<T>({
  id,
  title,
  icon,
  section,
  empty,
  moreHref,
  children,
}: {
  id: string
  title: string
  icon: ReactNode
  section: CockpitSection<T>
  empty: string
  moreHref: string
  children: (item: T) => ReactNode
}) {
  const more = section.count - section.items.length
  return (
    <section id={id} aria-label={title} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
      <div className="flex items-center gap-1.5">
        <span className="text-white/45" aria-hidden="true">{icon}</span>
        <h2 className="text-[12px] font-medium text-white/85">{title}</h2>
        <span className="ml-auto text-[10px] font-mono text-white/35">{section.count}</span>
      </div>
      {section.count === 0 ? (
        <p className="mt-3 text-[12px] text-white/35">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {section.items.map(children)}
          {more > 0 && (
            <li>
              <Link href={moreHref} className="text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white/70">
                …and {more} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

export function CockpitRow({ href, tag, text, detail }: { href: string; tag?: string; text: string; detail?: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg bg-black/10 border border-white/[0.05] px-3 py-2 transition-colors hover:bg-white/[0.06] hover:border-white/[0.10]"
      >
        <p className="text-[12px] text-white/80 line-clamp-2">
          {tag && <span className="text-white/35 mr-1.5 font-mono">{tag}</span>}
          {text}
        </p>
        {detail && <p className="mt-0.5 text-[10px] text-white/35">{detail}</p>}
      </Link>
    </li>
  )
}
