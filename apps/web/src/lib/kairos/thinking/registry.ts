import type { ThinkingJobHandler } from '@/lib/kairos/engine/types'
import { aetherHandler } from './handlers/aether'
import { beliefExtractHandler } from './handlers/belief-extract'
import { chatHandler } from './handlers/chat'
import { conceptHandler } from './handlers/concept'
import { cortexHandler } from './handlers/cortex'
import { dailyMessageHandler } from './handlers/daily-message'
import { driftProbeHandler } from './handlers/drift-probe'
import { mindCompareHandler } from './handlers/mind-compare'
import { weeklyReviewHandler } from './handlers/weekly-review'

// Every kind the thinking queue can plan, serve and apply. List order does
// not decide planning order — ThinkingQueue.planDue sorts by prerequisites.
export function getThinkingHandlers(): ThinkingJobHandler[] {
  return [
    aetherHandler,
    cortexHandler,
    conceptHandler,
    beliefExtractHandler,
    driftProbeHandler,
    mindCompareHandler,
    weeklyReviewHandler,
    dailyMessageHandler,
    chatHandler,
  ]
}
