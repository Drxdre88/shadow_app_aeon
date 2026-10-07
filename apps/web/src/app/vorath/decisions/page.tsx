import { listOwnKairosDecisions } from '@/lib/actions/kairos-decisions'
import { DecisionJournal } from '@/components/kairos/decisions/DecisionJournal'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Decision journal' }

export default async function DecisionsPage() {
  const initial = await listOwnKairosDecisions('all')
  return <DecisionJournal initial={initial} />
}
