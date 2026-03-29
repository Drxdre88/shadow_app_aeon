import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'

const wrappedGET = async (req: NextRequest) => {
  try {
    return (await handlers.GET(req)) ?? Response.json({ error: 'No auth response' }, { status: 500 })
  } catch (error) {
    console.error('[Auth GET Error]', error)
    return Response.json({ error: 'Auth error' }, { status: 500 })
  }
}

const wrappedPOST = async (req: NextRequest) => {
  try {
    return (await handlers.POST(req)) ?? Response.json({ error: 'No auth response' }, { status: 500 })
  } catch (error) {
    console.error('[Auth POST Error]', error)
    return Response.json({ error: 'Auth error' }, { status: 500 })
  }
}

export { wrappedGET as GET, wrappedPOST as POST }
