export const STAGE_FIELD_MAX_DEFAULT = 2

// The optional `stage` output field pulse and reflect may add (spec_stage §3
// mechanism (a)). Appended to the system prompt only while KAIROS_STAGE is not
// 'off', so prompts stay byte-identical with the stage off. Parsing is
// parseStageItems from '@/lib/kairos/stage' (never throws, ≤2 kept).

export function stageFieldLines(max: number = STAGE_FIELD_MAX_DEFAULT): string[] {
  return [
    '',
    `Optionally add "stage" to the same object: at most ${max} things you noticed that are worth holding in mind right now, each {"text": "one plain sentence, no ids or links", "surprise": 0–1, "importance": 0–1}. Leave it out when nothing stands out.`,
  ]
}

export function withStageField(system: string, on: boolean, max: number = STAGE_FIELD_MAX_DEFAULT): string {
  return on ? [system, ...stageFieldLines(max)].join('\n') : system
}
