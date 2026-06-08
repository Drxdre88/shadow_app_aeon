-- Brain — provenance / trust scaffolding (foundation for honest supersession +
-- the eventual bi-temporal graph). All additive + nullable: existing rows get
-- NULL, no rewrite, no lock of consequence. Modelled in schema.ts so db:push
-- keeps them. MUST run before deploying the matching code (schema.ts now
-- references these columns, so .select()/.returning() would error without them).
--
--   confidence       — coarse trust prior (0–1) stamped from streamClass on
--                      write. Operator reflections ≈ ground truth; agent /
--                      execution output lower. Weights retrieval + gates
--                      proposal auto-promotion (autonomy L2+).
--   superseded_at    — when a newer memory replaced this one's claim. Stamp,
--   superseded_by_id   don't delete — keeps the belief trail time-travelable.
--                      Soft pointer (no FK) so a hard delete never blocks.

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confidence" real;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "superseded_by_id" uuid;
