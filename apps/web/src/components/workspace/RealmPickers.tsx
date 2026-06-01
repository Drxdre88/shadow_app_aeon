'use client'

import {
  Orbit, Rocket, Globe, Zap, Shield, Flame, Star, Diamond,
  Crown, Swords, Anchor, Mountain, Atom, Bug, Coffee, Gamepad2,
  Hourglass, Satellite, FlaskConical, Cpu, Factory, Banknote, Network, Truck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { colorConfig, type AccentColor } from '@/lib/utils/colors'

export const REALM_ICON_MAP: Record<string, LucideIcon> = {
  orbit: Orbit,
  rocket: Rocket,
  globe: Globe,
  zap: Zap,
  shield: Shield,
  flame: Flame,
  star: Star,
  diamond: Diamond,
  crown: Crown,
  swords: Swords,
  anchor: Anchor,
  mountain: Mountain,
  atom: Atom,
  bug: Bug,
  coffee: Coffee,
  gamepad: Gamepad2,
  // Kairos Phase 2 (A2) — Dominion-flavour icons. Also surfaced in the realm
  // picker since Dominions reuse this map.
  hourglass: Hourglass,
  satellite: Satellite,
  flask: FlaskConical,
  cpu: Cpu,
  factory: Factory,
  banknote: Banknote,
  network: Network,
  truck: Truck,
}

export const REALM_ICON_KEYS = Object.keys(REALM_ICON_MAP)

const REALM_COLORS: AccentColor[] = ['purple', 'blue', 'cyan', 'green', 'pink', 'orange', 'red']

export function RealmColorPicker({ selected, onSelect }: { selected: string; onSelect: (c: string) => void }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">Color</label>
      <div className="flex gap-2 flex-wrap">
        {REALM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
              'w-7 h-7 rounded-full transition-all duration-200',
              selected === c
                ? 'ring-2 ring-white/60 scale-110'
                : 'hover:scale-110 ring-1 ring-white/10'
            )}
            style={{ backgroundColor: colorConfig[c].hex }}
          />
        ))}
      </div>
    </div>
  )
}

export function RealmIconPicker({ selected, onSelect }: { selected: string; onSelect: (i: string) => void }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">Icon</label>
      <div className="flex gap-1.5 flex-wrap">
        {REALM_ICON_KEYS.map((key) => {
          const Icon = REALM_ICON_MAP[key]
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200',
                selected === key
                  ? 'bg-white/15 ring-1 ring-white/30 text-white'
                  : 'bg-white/5 text-slate-500 hover:text-white/70 hover:bg-white/10'
              )}
            >
              <Icon className="w-4 h-4" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
