import { getBoardSnapshot } from '@/lib/actions/snapshots'
import { SharedBoardView } from './SharedBoardView'

interface Props {
  params: Promise<{ token: string }>
}

export default async function SharePage({ params }: Props) {
  const { token } = await params
  const data = await getBoardSnapshot(token)

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-2xl font-bold text-white">Link Expired</p>
          <p className="text-sm text-slate-400">This shared board snapshot has expired or does not exist.</p>
        </div>
      </div>
    )
  }

  return <SharedBoardView data={data} />
}
