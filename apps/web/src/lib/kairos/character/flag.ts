// Character-drift check (weekly blind style rating) has its own switch.
// Off = no character_check job is planned, no weekly-review line is added,
// and tone-flagged hourly reflections stay in the agentic stream (they are
// still tagged, so the flag rate is measurable before the switch goes on).
export function characterCheckEnabled(): boolean {
  return process.env.KAIROS_CHARACTER_CHECK === '1'
}
