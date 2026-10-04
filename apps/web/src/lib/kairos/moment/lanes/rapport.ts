import { anyRapportFlag, anyRapportLive, bidsMode, readinessMode, repairMode } from '@/lib/kairos/rapport/flag'
import { rapportChatContext } from '@/lib/kairos/rapport/chat-context'
import { onChatReply, onOwnerTurn } from '@/lib/kairos/rapport/owner-turn'
import { rapportDaily, rapportDailyDelivered, rapportOwnerDecision, rapportSpeakPolicy } from '@/lib/kairos/rapport/speak-policy'
import { ackMediaBid } from '@/lib/kairos/rapport/telegram-bid'
import type { MomentLane } from '../types'

// Lane C (readiness, small bids, repair). Hooks exist only while their flag
// is set (KAIROS_READINESS / KAIROS_BIDS / KAIROS_REPAIR), so with every flag
// off the seam sees no rapport hook at all: nothing detached, no policy, no
// prompt part, no Telegram call — byte-identical to before.
export const rapportLane: MomentLane = {
  get ownerTurn() {
    return anyRapportFlag() ? onOwnerTurn : undefined
  },
  get reply() {
    return repairMode() !== 'off' || readinessMode() !== 'off' ? onChatReply : undefined
  },
  get chatContext() {
    return anyRapportLive() ? rapportChatContext : undefined
  },
  get speakPolicy() {
    return repairMode() !== 'off' ? rapportSpeakPolicy : undefined
  },
  get daily() {
    return repairMode() === 'on' ? rapportDaily : undefined
  },
  get dailyDelivered() {
    return repairMode() === 'on' ? rapportDailyDelivered : undefined
  },
  get ownerDecision() {
    return repairMode() !== 'off' ? rapportOwnerDecision : undefined
  },
  get telegramMessage() {
    return bidsMode() !== 'off' ? ackMediaBid : undefined
  },
}
