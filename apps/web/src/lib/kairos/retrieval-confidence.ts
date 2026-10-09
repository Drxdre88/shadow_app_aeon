// ─────────────────────────────────────────────────────────────────────────
// Retrieval confidence (search_memories + prepare_context). The signal is the
// best Voyage rerank-2.5 relevance in the reranked pool — the only score on a
// calibrated 0..1 scale. No rerank (FTS fallback, browse, Voyage down) means
// no calibrated signal: confidence is null and nothing is flagged.
//
// Floor chosen from eval/scores-0910.json (40-question retrieval eval against
// production, search path, 09/10), best rerank relevance per question:
//   - abstention (4):            0.318, 0.393, 0.402, 0.494
//   - answerable, hit in top-5 (25; 26 in after-0910 with tm03 at 0.852):
//     min 0.439 (en02), next 0.660 (tm04), median ≈ 0.83
//   - answerable misses (11):    0.447 .. 0.852
// No clean separation: en02 (0.439, relevant at rank 1) sits below ab01
// (0.494), so a hard floor that drops all four abstentions also drops en02 and
// costs top-5 recall. Per Vorath's condition (dialogue e898a7f6) hits are kept
// and only flagged. 0.55 flags all 4 abstentions plus 4 answerable questions
// (ku04, sf10, ku08 misses; en02 the one true hit) and leaves 24/25 top-5 hits
// (96%) unflagged, with 0.056 margin above ab01 and 0.11 below tm04.
// ─────────────────────────────────────────────────────────────────────────

export const RETRIEVAL_CONFIDENCE_FLOOR = 0.55

export interface RetrievalConfidence {
  // Best rerank relevance (0..1), rounded; null when no calibrated signal.
  confidence: number | null
  // True when the best match is below the floor: treat hits as weak evidence.
  lowConfidence: boolean
}

export function assessConfidence(
  topRelevance: number | null | undefined,
  floor: number = RETRIEVAL_CONFIDENCE_FLOOR,
): RetrievalConfidence {
  if (topRelevance == null || !Number.isFinite(topRelevance)) return { confidence: null, lowConfidence: false }
  return { confidence: Number(topRelevance.toFixed(3)), lowConfidence: topRelevance < floor }
}
