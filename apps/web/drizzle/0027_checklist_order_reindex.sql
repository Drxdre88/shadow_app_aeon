-- Checklist order determinism: legacy rows (Mar-May 2026 group-local indexing
-- bug) carry duplicate order_index values per task; ORDER BY order_index alone
-- then returns ties in arbitrary, query-to-query-unstable order ("checklists
-- jump around"). Re-number every task's items sequentially, breaking ties by
-- (created_at, id) so current visible order is preserved as closely as possible.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY task_id
           ORDER BY order_index, created_at, id
         ) - 1 AS new_idx
  FROM checklist_items
)
UPDATE checklist_items ci
SET order_index = r.new_idx
FROM ranked r
WHERE ci.id = r.id
  AND ci.order_index <> r.new_idx;
