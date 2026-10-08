import test from 'node:test'
import assert from 'node:assert/strict'
import { isAutomatedFirstMessage } from './session-filters.mjs'

test('scheduled quant research loops are automated sessions', () => {
  assert.equal(isAutomatedFirstMessage('You are an autonomous Swarm AI Quant research session. Run the loop.'), true)
  assert.equal(isAutomatedFirstMessage('  you are an autonomous RND AI QUANT research session for signals'), true)
})

test('the research-loop pattern is anchored to the start of the first message', () => {
  assert.equal(isAutomatedFirstMessage('Why does "You are an autonomous Swarm AI Quant research session" keep getting captured?'), false)
  assert.equal(isAutomatedFirstMessage('You are an autonomous coding agent. Fix the board.'), false)
})

test('hook-child sentinels still match anywhere in the first message', () => {
  assert.equal(isAutomatedFirstMessage('Please drain the Aeon memory summary backlog now.'), true)
  assert.equal(isAutomatedFirstMessage('You are running headless to drain the queue'), true)
})

test('empty or missing first messages are not automated', () => {
  assert.equal(isAutomatedFirstMessage(null), false)
  assert.equal(isAutomatedFirstMessage('   '), false)
  assert.equal(isAutomatedFirstMessage('Wire the capture hook'), false)
})
