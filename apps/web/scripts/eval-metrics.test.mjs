// Scoring-maths tests for the retrieval eval (no network). Run: node --test scripts/eval-metrics.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recallAtK, hitAtK, reciprocalRank, staleAbove, abstentionPass, abstentionRule, relevantVia, scoreQuestion,
  aggregate, aggregateByCategory, CATEGORIES,
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
  assert.deepEqual(s, { abstain: 1, abstainRule: 'empty', falseHits: 0 })
})

test('abstention also passes on retrieval.lowConfidence, and reports which rule passed', () => {
  assert.equal(abstentionPass(['x'], 10, true), 1)
  assert.equal(abstentionPass(['x'], 10, false), 0)
  assert.equal(abstentionPass(['x'], 10, undefined), 0)
  assert.equal(abstentionRule([], 10, true), 'empty')
  assert.equal(abstentionRule(['x'], 10, true), 'lowConfidence')
  assert.equal(abstentionRule(['x'], 10, 'true'), null)
  const s = scoreQuestion({ category: 'abstention', relevantIds: [] }, ['x', 'y'], ['x', 'y'], { lowConfidence: true })
  assert.deepEqual(s, { abstain: 1, abstainRule: 'lowConfidence', falseHits: 2 })
  const rows = [
    { category: 'abstention', score: s },
    { category: 'abstention', score: scoreQuestion({ category: 'abstention', relevantIds: [] }, [], []) },
    { category: 'abstention', score: scoreQuestion({ category: 'abstention', relevantIds: [] }, ['x'], ['x'], { lowConfidence: false }) },
  ]
  const agg = aggregate(rows)
  assert.equal(agg.abstainN, 3)
  assert.equal(agg.abstainPass, 2 / 3)
  assert.deepEqual(agg.abstainByRule, { empty: 1, lowConfidence: 1 })
})

test('relevant hits are counted by via; absent or unknown via counts as search', () => {
  assert.deepEqual(relevantVia(['a', 'b', 'c', 'd'], ['search', 'link', undefined, 'signpost'], ['b', 'c', 'd'], 10),
    { search: 1, link: 1, signpost: 1 })
  assert.deepEqual(relevantVia(['a', 'b'], undefined, ['a', 'b'], 10), { search: 2, link: 0, signpost: 0 })
  assert.deepEqual(relevantVia(['a', 'b'], ['link', 'odd'], ['a', 'b'], 1), { search: 0, link: 1, signpost: 0 })
  const s = scoreQuestion({ category: 'entity', relevantIds: ['b'] }, ['a', 'b'], ['a', 'b'], { via: ['search', 'signpost'], lowConfidence: true })
  assert.deepEqual(s.via, { search: 0, link: 0, signpost: 1 })
  assert.equal(s.lowConfidence, 1)
  const agg = aggregate([{ category: 'entity', score: s }])
  assert.deepEqual(agg.relevantVia, { search: 0, link: 0, signpost: 1 })
  assert.equal(agg.lowConfidenceAnswerable, 1)
})

test('big_picture is a scored category of its own', () => {
  assert.ok(CATEGORIES.includes('big_picture'))
  const rows = [
    { category: 'big_picture', score: scoreQuestion({ category: 'big_picture', relevantIds: ['c', 'z'] }, ranked, ranked) },
    { category: 'entity', score: scoreQuestion({ category: 'entity', relevantIds: ['a'] }, ranked, ranked) },
  ]
  const byCat = aggregateByCategory(rows)
  assert.equal(byCat.big_picture.n, 1)
  assert.equal(byCat.big_picture.recall10, 0.5)
  assert.equal(byCat.big_picture.mrr, 1 / 3)
  assert.equal(byCat.entity.hit1, 1)
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
