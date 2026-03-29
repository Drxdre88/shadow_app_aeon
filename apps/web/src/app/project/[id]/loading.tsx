export default function ProjectLoading() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="px-2 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] animate-pulse" />
          <div className="w-6 h-6 rounded bg-white/[0.06] animate-pulse" />
          <div className="h-5 w-32 rounded bg-white/[0.06] animate-pulse" />
          <div className="flex items-center gap-1 ml-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 w-16 rounded-lg bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        </div>
      </header>

      <main className="px-0 sm:px-6 py-2">
        <div className="flex gap-4">
          {[...Array(4)].map((_, colIdx) => (
            <div key={colIdx} className="flex-1 min-w-[250px] space-y-3">
              <div className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
              {[...Array(colIdx === 0 ? 3 : colIdx === 1 ? 2 : 1)].map((_, cardIdx) => (
                <div key={cardIdx} className="rounded-xl bg-white/[0.03] animate-pulse p-3 space-y-2">
                  <div className="h-3 w-16 rounded bg-white/[0.06]" />
                  <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
                  <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                  <div className="flex gap-2 pt-2 border-t border-white/[0.04]">
                    <div className="h-5 w-14 rounded bg-white/[0.05]" />
                    <div className="h-5 w-20 rounded bg-white/[0.04]" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
