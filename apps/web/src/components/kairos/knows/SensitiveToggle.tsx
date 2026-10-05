'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { getSensitiveGateSetting, setSensitiveGateSetting } from '@/lib/actions/memory-knows'
import { MIND_NAME } from '@/lib/kairos/identity'

// Opt-in, default OFF: hold new memories about health, family, money, legal
// matters, religion or politics until the owner confirms them.
export function SensitiveToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSensitiveGateSetting().then(setOn).catch(() => setOn(null))
  }, [])

  const flip = async () => {
    if (on === null) return
    setBusy(true)
    try {
      setOn(await setSensitiveGateSetting(!on))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-t border-white/[0.06]">
      <ShieldCheck className="w-3.5 h-3.5 text-white/40 mt-0.5 shrink-0" />
      <div className="flex-1 text-[10.5px] text-white/50 leading-snug">
        <div className="text-[11px] text-white/80 font-medium">Ask me before using private topics</div>
        New notes about health, family, money, legal matters, religion or politics wait here until you confirm them. {MIND_NAME} won&rsquo;t use them before that.
      </div>
      <button
        role="switch"
        aria-checked={on === true}
        aria-label="Ask me before using private topics"
        onClick={flip}
        disabled={busy || on === null}
        className={`relative shrink-0 w-8 h-[18px] rounded-full border transition-colors disabled:opacity-40 ${
          on ? 'border-transparent' : 'bg-white/[0.06] border-white/[0.10]'
        }`}
        style={on ? { background: 'color-mix(in srgb, var(--primary) 60%, transparent)' } : undefined}
      >
        <span className={`absolute top-[2px] w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
      </button>
    </div>
  )
}
