import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const response = await handlers.GET(req)
    if (!response) {
      console.error('[Auth GET] Handler returned no response')
      return Response.json({ error: 'No auth response' }, { status: 500 })
    }
    return response
  } catch (error) {
    console.error('[Auth GET Error]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Auth error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const response = await handlers.POST(req)
    if (!response) {
      console.error('[Auth POST] Handler returned no response')
      return Response.json({ error: 'No auth response' }, { status: 500 })
    }
    return response
  } catch (error) {
    console.error('[Auth POST Error]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Auth error' }, { status: 500 })
  }
}
