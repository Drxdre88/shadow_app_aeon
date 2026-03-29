'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Palette, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig, getRecentColors, addRecentColor } from '@/lib/utils/colors'

interface ColorSwatchPickerProps {
  value: string
  onChange: (color: string) => void
  onChangeNative?: (color: string) => void
  isOpen?: boolean
  onClose?: () => void
  closeOnSelect?: boolean
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
  closeOnSelect = true,
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
      if (closeOnSelect) onClose?.()
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
          onClick={() => { onChange(hex); if (closeOnSelect) onClose?.() }}
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
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Accent</span>
          <div className="flex gap-1.5 flex-wrap items-center">
            {accentColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); if (closeOnSelect) onClose?.() }}
                className={cn(
                  sizeClass,
                  shapeClass,
                  'border-2 transition-all flex-shrink-0 hover:scale-110',
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
        </div>
        {expanded && (
          <>
            {recentRow && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Recent</span>
                {recentRow}
              </div>
            )}
            {showPalette && (
              <div className="border-t border-white/10 pt-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Palette</span>
                <div className="grid grid-cols-7 gap-1">
                  {PALETTE_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => { onChange(hex); if (closeOnSelect) onClose?.() }}
                      className={cn(
                        'w-6 h-6',
                        shapeClass,
                        'border-2 transition-all hover:scale-110',
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
    <div>
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Accent</span>
      <div className="flex gap-1.5 flex-wrap">
        {accentColors.map((c) => (
          <button
            key={c}
            onClick={() => { onChange(c); if (closeOnSelect) onClose?.() }}
            className={cn(
              sizeClass,
              shapeClass,
              'border-2 transition-all hover:scale-110',
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
    </div>
  )

  const paletteGrid = showPalette ? (
    <div className="border-t border-white/10 pt-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Palette</span>
      <div className="grid grid-cols-7 gap-1">
        {PALETTE_COLORS.map((hex) => (
          <button
            key={hex}
            onClick={() => { onChange(hex); if (closeOnSelect) onClose?.() }}
            className={cn(
              sizeClass,
              shapeClass,
              'border-2 transition-all hover:scale-110',
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
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">Recent</span>
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

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl overflow-hidden bg-gradient-to-b from-white/[0.08] to-black/40 backdrop-blur-xl border border-white/[0.1] min-w-[260px]"
            style={{ boxShadow: '0 0 40px rgba(139, 92, 246, 0.15), 0 8px 32px rgba(0,0,0,0.5)' }}
          >
            <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent" />
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-sm font-semibold text-white">Color</span>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="px-4 pb-4">
              {content}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
