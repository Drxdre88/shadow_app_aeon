-- Brain Phase 4 (P2) — semantic vector layer for hybrid retrieval.
--
-- Adds a pgvector embedding column + HNSW cosine index to `memories`.
-- Vectors are 1024-dim (voyage-3.5 primary / openai text-embedding-3-small@1024
-- fallback) so the column type is fixed regardless of which provider is active.
--
-- The HNSW index builds INSTANTLY here: every existing row has a NULL embedding
-- at migration time, so there are no vectors to index yet. The embed-backfill
-- cron (apps/web/src/app/api/cron/embed-backfill) populates them afterwards and
-- the index maintains itself incrementally. NULL embeddings are skipped by the
-- index and excluded from `<=>` ordering — safe to backfill asynchronously.
--
-- Like the `fts` generated column and GIN indexes (migration 0013), the HNSW
-- index is managed in raw SQL, not Drizzle. The `embedding` / `embedding_model`
-- columns ARE modelled in schema.ts so db:push keeps them.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding_model" varchar(40);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "memories_embedding_idx"
  ON "memories" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
