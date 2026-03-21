'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Palette, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig, getRecentColors, addRecentColor } from '@/lib/utils/colors'

interface ColorSwatchPickerProps {
  value: string
  onChange: (color: string) => void
  onChangeNative?: (color: string) => void
  isOpen?: boolean
  onClose?: () => void
  showPalette?: boolean
  swatchSize?: 'sm' | 'md'
  swatchShape?: 'circle' | 'square'
  accentColors?: AccentColor[]
  inline?: boolean
  className?: string
  animated?: boolean
}

export function ColorSwatchPicker({
  value,
  onChange,
  onChangeNative,
  isOpen = true,
  onClose,
  showPalette = true,
  swatchSize = 'md',
  swatchShape = 'circle',
  accentColors = ACCENT_COLORS,
  inline = false,
  className,
  animated = false,
}: ColorSwatchPickerProps) {
  const [recentColors, setRecentColors] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setRecentColors(getRecentColors())
  }, [isOpen, expanded])

  const sizeClass = swatchSize === 'sm' ? 'w-6 h-6' : 'w-7 h-7'
  const shapeClass = swatchShape === 'circle' ? 'rounded-full' : 'rounded-lg'
  const currentHex = value.startsWith('#')
    ? value
    : colorConfig[value as AccentColor]?.hex ?? '#a855f7'

  const handleCustomColor = (hex: string) => {
    addRecentColor(hex)
    setRecentColors(getRecentColors())
    if (onChangeNative) {
      onChangeNative(hex)
    } else {
      onChange(hex)
      onClose?.()
    }
  }

  const customSwatch = (
    <label className={cn('relative flex-shrink-0', !inline && 'flex items-center gap-2 cursor-pointer group')}>
      <div className="relative">
        <input
          type="color"
          value={currentHex}
          onChange={(e) => handleCustomColor(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className={cn(
            sizeClass,
            shapeClass,
            'border-2 border-dashed border-white/30 transition-all flex items-center justify-center',
            inline ? 'hover:border-white/50' : 'group-hover:border-white/60'
          )}
          style={{ backgroundColor: value.startsWith('#') ? value : 'transparent' }}
        >
          {!value.startsWith('#') && (
            swatchShape === 'square'
              ? <span className="text-[10px] text-slate-500">+</span>
              : <Palette className="w-3 h-3 text-slate-400" />
          )}
        </div>
      </div>
      {!inline && (
        <span className={cn(
          'text-slate-500 group-hover:text-slate-300 transition-colors',
          swatchSize === 'sm' ? 'text-[10px]' : 'text-[11px]'
        )}>
          Custom
        </span>
      )}
    </label>
  )

  const recentRow = recentColors.length > 0 ? (
    <div className={cn(inline ? 'flex gap-1 flex-wrap items-center' : 'flex gap-1.5 flex-wrap')}>
      {recentColors.map((hex) => (
        <button
          key={hex}
          type="button"
          onClick={() => { onChange(hex); onClose?.() }}
          className={cn(
            swatchSize === 'sm' ? 'w-5 h-5' : 'w-6 h-6',
            shapeClass,
            'border-2 transition-all flex-shrink-0',
            value === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
          )}
          style={{ backgroundColor: hex }}
          title="Recent"
        />
      ))}
    </div>
  ) : null

  if (inline) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex gap-1.5 flex-wrap items-center">
          {accentColors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); onClose?.() }}
              className={cn(
                sizeClass,
                shapeClass,
                'border-2 transition-all flex-shrink-0',
                value === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
              )}
              style={{ backgroundColor: colorConfig[c].hex }}
            />
          ))}
          {customSwatch}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center',
              'border border-white/20 hover:border-white/40 transition-all',
              'text-slate-400 hover:text-white',
              expanded && 'bg-white/10 border-white/30'
            )}
          >
            <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
        {expanded && (
          <>
            {recentRow && (
              <div>
                <span className="text-[10px] text-slate-500 mb-1 block">Recent</span>
                {recentRow}
              </div>
            )}
            {showPalette && (
              <div className="border-t border-white/10 pt-2">
                <div className="grid grid-cols-7 gap-1">
                  {PALETTE_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => { onChange(hex); onClose?.() }}
                      className={cn(
                        'w-6 h-6',
                        shapeClass,
                        'border-2 transition-all',
                        value === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const accentRow = (
    <div className="flex gap-1.5 flex-wrap">
      {accentColors.map((c) => (
        <button
          key={c}
          onClick={() => { onChange(c); onClose?.() }}
          className={cn(
            sizeClass,
            shapeClass,
            'border-2 transition-all',
            value === c
              ? 'border-white scale-110'
              : 'border-transparent hover:border-white/40'
          )}
          style={{
            backgroundColor: colorConfig[c].hex,
            ...(value === c && swatchShape === 'square'
              ? { boxShadow: `0 0 12px ${colorConfig[c].glow}` }
              : undefined),
          }}
        />
      ))}
    </div>
  )

  const paletteGrid = showPalette ? (
    <div className="border-t border-white/10 pt-2">
      <div className="grid grid-cols-7 gap-1">
        {PALETTE_COLORS.map((hex) => (
          <button
            key={hex}
            onClick={() => { onChange(hex); onClose?.() }}
            className={cn(
              sizeClass,
              shapeClass,
              'border-2 transition-all',
              value === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  ) : null

  const content = (
    <div className={cn('space-y-2', className)}>
      {accentRow}
      {recentRow && (
        <div>
          <span className="text-[10px] text-slate-500 mb-1 block">Recent</span>
          {recentRow}
        </div>
      )}
      {paletteGrid}
      <div className="pt-1 border-t border-white/10">
        {customSwatch}
      </div>
    </div>
  )

  if (!animated) return isOpen ? content : null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            className="absolute left-0 top-full mt-2 z-50 p-3 rounded-xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-xl min-w-[240px]"
          >
            {content}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
