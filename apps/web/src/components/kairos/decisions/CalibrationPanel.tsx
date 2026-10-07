'use client'

import type { DecisionCalibration } from '@/lib/kairos/decisions/types'
import { calibrationLines } from '@/lib/kairos/decisions/render'

export function CalibrationPanel({ calibration }: { calibration: DecisionCalibration }) {
  const lines = calibrationLines(calibration)
  return (
    <section aria-label="Your calibration" className="rounded-xl bg-white/[0.04] border border-violet-300/15 p-4">
      <h2 className="text-[12px] font-medium text-white/85">How your calls land</h2>
      <p className="mt-1 text-[10px] text-white/35">Per decision type, once {calibration.minPerType} are settled. Void and unconfirmed relayed ones don&apos;t count.</p>
      {lines.length === 0 ? (
        <p className="mt-3 text-[12px] text-white/45">Nothing settled yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {lines.map((line) => <li key={line} className="text-[12px] text-white/75">{line}</li>)}
        </ul>
      )}
    </section>
  )
}
