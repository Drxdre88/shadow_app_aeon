// Aether — shared contract types. No runtime dependencies.

/** A single synthesised thought surfaced by the Aether engine. */
export interface AetherThought {
  /** Stable UUID assigned at generation time. */
  id: string
  /** Short tag for the thought (1–3 words). */
  title: string
  /** One-paragraph insight text. */
  insight: string
  /** Dominion UUID this thought originates from, or null for cross-cutting thoughts. */
  dominionId: string | null
  /** Display name of the Dominion at generation time. */
  dominionName: string | null
  /** Dominion color token (e.g. 'purple', 'cyan') at generation time. */
  dominionColor: string | null
  /** Importance score in the range 0..1 — drives size and brightness in the scene. */
  salience: number
  /** Semantic kind — controls visual treatment and grouping. */
  kind: 'conclusion' | 'tension' | 'connection' | 'question' | 'eureka'
  /** IDs of the source memories this thought was synthesised from. */
  sourceMemoryIds: string[]
  /** How many days old the underlying source material is (drives fade/recede). */
  ageDays: number
}

/** A directed tension between two thoughts. */
export interface AetherTension {
  /** ID of the first thought in the tension pair. */
  aId: string
  /** ID of the second thought in the tension pair. */
  bId: string
  /** Short description of what the tension is. */
  note: string
}

/**
 * Full output of one Aether generation run.
 * Stored verbatim as sourceMetadata.aether on the type='aether' memory.
 */
export interface AetherPayload {
  /** ISO 8601 UTC timestamp of generation. */
  generatedAt: string
  /** 2–4 sentence narrative arc across all thoughts. */
  coreNarrative: string
  /** All synthesised thoughts for this run (typically 5–15). */
  thoughts: AetherThought[]
  /** Detected tensions between thought pairs. */
  tensions: AetherTension[]
  /** Notable shifts or pattern changes observed since the prior run. */
  shifts: string[]
}

/**
 * Derived visual descriptor for a single thought in the 3D scene.
 * Computed client-side from AetherThought; not persisted.
 */
export interface ThoughtVisual {
  /** The source thought. */
  thought: AetherThought
  /** Hue in degrees (0..360) derived from the Dominion color. */
  hue: number
  /** Sphere radius in scene units — proportional to salience. */
  radius: number
  /** Bloom/glow intensity in the range 0..1 — eureka = 1, stale = near 0. */
  glow: number
  /** [x, y, z] world-space position in the scene. */
  position: [number, number, number]
  /** Whether this thought is currently selected. */
  selected: boolean
}
