// Track record (spec B) has its own switch, independent of KAIROS_INITIATIVE.
// Off = no prediction is asked for, created, settled or rendered.
export function predictionsEnabled(): boolean {
  return process.env.KAIROS_PREDICTIONS === '1'
}
