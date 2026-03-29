'use client'

interface BoardGlowBackgroundProps {
  glowColor: string
  globalGlow: number
}

export function BoardGlowBackground({ glowColor, globalGlow }: BoardGlowBackgroundProps) {
  const glowMult = globalGlow / 75
  const op1 = Math.round(8 * glowMult).toString(16).padStart(2, '0')
  const op2 = Math.round(5 * glowMult).toString(16).padStart(2, '0')
  const op3 = Math.round(21 * glowMult).toString(16).padStart(2, '0')
  const op4 = Math.round(16 * glowMult).toString(16).padStart(2, '0')

  return (
    <div
      className="absolute inset-0 -z-10 rounded-3xl overflow-hidden"
      style={{
        background: globalGlow > 0 ? `linear-gradient(135deg, ${glowColor}${op1} 0%, transparent 50%, ${glowColor}${op2} 100%)` : 'transparent',
      }}
    >
      {globalGlow > 0 && (
        <>
          <div
            className="absolute inset-0 backdrop-blur-3xl"
            style={{ background: `radial-gradient(ellipse at top left, ${glowColor}${op3} 0%, transparent 50%)` }}
          />
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(ellipse at bottom right, ${glowColor}${op4} 0%, transparent 50%)` }}
          />
        </>
      )}
    </div>
  )
}
