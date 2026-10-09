// Scoring-maths tests for the retrieval eval (no network). Run: node --test scripts/eval-metrics.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recallAtK, hitAtK, reciprocalRank, staleAbove, abstentionPass, scoreQuestion, aggregate, aggregateByCategory,
} from './eval-metrics.mjs'

const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']

test('recall@k counts relevant ids inside the cutoff only', () => {
  assert.equal(recallAtK(ranked, ['b', 'k'], 5), 0.5)
  assert.equal(recallAtK(ranked, ['b', 'k'], 11), 1)
  assert.equal(recallAtK(ranked, ['z'], 10), 0)
  assert.equal(recallAtK(ranked, [], 10), null)
})

test('hit@k and reciprocal rank use the first relevant position', () => {
  assert.equal(hitAtK(ranked, ['a'], 1), 1)
  assert.equal(hitAtK(ranked, ['b'], 1), 0)
  assert.equal(reciprocalRank(ranked, ['c', 'e']), 1 / 3)
  assert.equal(reciprocalRank(ranked, ['z']), 0)
  assert.equal(reciprocalRank([], ['a']), 0)
})

test('staleAbove flags a must-not id ranked above the first relevant id', () => {
  assert.equal(staleAbove(ranked, ['c'], ['b'], 10), 1)
  assert.equal(staleAbove(ranked, ['b'], ['c'], 10), 0)
  assert.equal(staleAbove(ranked, ['z'], ['d'], 10), 1)
  assert.equal(staleAbove(ranked, ['z'], ['k'], 10), 0)
  assert.equal(staleAbove(ranked, ['a'], undefined, 10), null)
})

test('abstention passes only when no query-driven candidate is returned', () => {
  assert.equal(abstentionPass([], 10), 1)
  assert.equal(abstentionPass(['x'], 10), 0)
  const s = scoreQuestion({ category: 'abstention', relevantIds: [] }, ['pinned1'], [])
  assert.deepEqual(s, { abstain: 1, falseHits: 0 })
})

test('scoreQuestion and aggregate keep abstention out of ranking means', () => {
  const rows = [
    { category: 'single_fact', score: scoreQuestion({ category: 'single_fact', relevantIds: ['a'] }, ranked, ranked) },
    { category: 'temporal', score: scoreQuestion({ category: 'temporal', relevantIds: ['f', 'z'] }, ranked, ranked) },
    { category: 'abstention', score: scoreQuestion({ category: 'abstention', relevantIds: [] }, ranked, ranked) },
    { category: 'entity', error: 'HTTP 500', score: null },
  ]
  const agg = aggregate(rows)
  assert.equal(agg.n, 2)
  assert.equal(agg.recall5, 0.5)
  assert.equal(agg.recall10, 0.75)
  assert.equal(agg.mrr, (1 + 1 / 6) / 2)
  assert.equal(agg.hit1, 0.5)
  assert.equal(agg.abstainN, 1)
  assert.equal(agg.abstainPass, 0)
  assert.equal(agg.errors, 1)
  const byCat = aggregateByCategory(rows)
  assert.equal(byCat.temporal.recall10, 0.5)
  assert.equal(byCat.entity.n, 0)
  assert.equal(byCat.knowledge_update, undefined)
})
