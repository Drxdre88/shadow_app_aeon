import type { ThinkingJobHandler } from '@/lib/kairos/engine/types'
import { aetherHandler } from './handlers/aether'
import { agendaDueHandler } from './handlers/agenda-due'
import { archetypeHandler } from './handlers/archetype'
import { askMineHandler } from './handlers/ask-mine'
import { beliefExtractHandler } from './handlers/belief-extract'
import { cardTreeHandler } from './handlers/card-tree'
import { cardTriageHandler } from './handlers/card-triage'
import { chatDistillHandler } from './handlers/chat-distill'
import { characterCheckHandler } from './handlers/character-check'
import { chatHandler } from './handlers/chat'
import { coldReadHandler } from './handlers/cold-read'
import { conceptHandler } from './handlers/concept'
import { constitutionSeedHandler } from './handlers/constitution-seed'
import { cortexHandler } from './handlers/cortex'
import { dailyMessageHandler } from './handlers/daily-message'
import { dreamHandler } from './handlers/dream'
import { dreamReadHandler } from './handlers/dream-read'
import { driftProbeHandler } from './handlers/drift-probe'
import { goalProposeHandler } from './handlers/goal-propose'
import { ideaGenerateHandler } from './handlers/idea-generate'
import { ideaJudgeHandler } from './handlers/idea-judge'
import { lifeChapterHandler } from './handlers/life-chapter'
import { mindCompareHandler } from './handlers/mind-compare'
import { missionCheckHandler } from './handlers/mission-check'
import { pulseHandler } from './handlers/pulse'
import { reflectHandler } from './handlers/reflect'
import { repoLessonsHandler } from './handlers/repo-lessons'
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
    constitutionSeedHandler,
    characterCheckHandler,
    weeklyReviewHandler,
    lifeChapterHandler,
    ideaGenerateHandler,
    ideaJudgeHandler,
    dreamHandler,
    dreamReadHandler,
    goalProposeHandler,
    chatDistillHandler,
    archetypeHandler,
    askMineHandler,
    dailyMessageHandler,
    agendaDueHandler,
    reflectHandler,
    pulseHandler,
    coldReadHandler,
    cardTriageHandler,
    repoLessonsHandler,
    missionCheckHandler,
    cardTreeHandler,
    chatHandler,
  ]
}
