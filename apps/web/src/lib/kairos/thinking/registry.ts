import type { ThinkingJobHandler } from '@/lib/kairos/engine/types'
import { aetherHandler } from './handlers/aether'
import { conceptHandler } from './handlers/concept'
import { cortexHandler } from './handlers/cortex'

// Every kind the thinking queue can plan, serve and apply. List order does
// not decide planning order — ThinkingQueue.planDue sorts by prerequisites.
export function getThinkingHandlers(): ThinkingJobHandler[] {
  return [aetherHandler, cortexHandler, conceptHandler]
}
