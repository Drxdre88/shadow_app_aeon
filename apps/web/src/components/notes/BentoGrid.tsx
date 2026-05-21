export function BentoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid gap-3 p-4 sm:p-6"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gridAutoRows: '12rem',
        gridAutoFlow: 'dense',
      }}
    >
      {children}
    </div>
  )
}
