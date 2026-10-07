import { getOwnMorningCockpit } from '@/lib/actions/kairos-cockpit'
import { MorningCockpitView } from '@/components/kairos/cockpit/MorningCockpitView'

// Read-only morning cockpit, assembled on every request.

export default async function CockpitPage() {
  const cockpit = await getOwnMorningCockpit()
  return <MorningCockpitView cockpit={cockpit} />
}
