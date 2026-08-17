import { colorConfig, type AccentColor } from '@/lib/utils/colors'

export function labelHex(color: string): string {
  const preset = colorConfig[color as AccentColor]
  if (preset) return preset.hex
  return color.startsWith('#') ? color : `#${color}`
}

// Tiles are filled with the label colour, so the text has to flip to dark on
// bright fills to stay legible.
export function readableTextColor(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length < 6) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#ffffff'
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  return luminance > 0.45 ? '#0b0b0f' : '#ffffff'
}
