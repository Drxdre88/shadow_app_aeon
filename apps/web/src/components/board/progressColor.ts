// Progress uses one fixed palette for every card — the tint travels from warm
// yellow at low percentages to green at 100% so the colour alone reads as
// "how far along", independent of the card's own accent.
const START_HUE = 48
const END_HUE = 140

export function progressHue(progress: number): number {
  const pct = Math.min(100, Math.max(0, progress))
  return Math.round(START_HUE + (END_HUE - START_HUE) * (pct / 100))
}

export interface ProgressBarStyle {
  fill: string
  cloud: string
  glow: string
}

export function progressBarStyle(progress: number): ProgressBarStyle {
  const pct = Math.min(100, Math.max(0, progress))
  const hue = progressHue(pct)
  const complete = pct >= 100

  return {
    fill: `linear-gradient(90deg, hsla(${START_HUE}, 92%, 58%, 0.45), hsla(${hue}, 88%, 56%, 0.9))`,
    cloud: [
      `radial-gradient(120% 260% at 15% 50%, hsla(${START_HUE}, 100%, 72%, 0.55), transparent 62%)`,
      `radial-gradient(110% 240% at 70% 50%, hsla(${hue}, 100%, 66%, 0.5), transparent 66%)`,
    ].join(', '),
    glow: complete
      ? `0 0 6px hsla(${hue}, 90%, 58%, 0.6), 0 0 14px 2px hsla(${hue}, 90%, 55%, 0.45)`
      : `0 0 6px hsla(${hue}, 90%, 58%, 0.4)`,
  }
}
