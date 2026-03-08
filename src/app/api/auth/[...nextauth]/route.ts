import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'

const wrappedPOST = async (req: NextRequest) => {
  try {
    const response = await handlers.POST(req)
    return response ?? new Response(null, { status: 200 })
  } catch (error) {
    console.error('[Auth POST Error]', error)
    return new Response(JSON.stringify({ error: 'Auth error' }), { status: 500 })
  }
}

export const { GET } = handlers
export { wrappedPOST as POST }
