// Daytime thinking flag (spec A), kept import-free so the data layer and the
// routine catalog consumers can read it without pulling in the today module.
export function daytimeThinkingEnabled(): boolean {
  return process.env.KAIROS_DAYTIME_THINKING === '1'
}
