import { handlers } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const response = await handlers.GET(request)
    if (response) return response
    console.error('[auth] GET returned no response for', request.url)
    return NextResponse.json({ error: 'Auth handler returned no response' }, { status: 500 })
  } catch (error) {
    console.error('[auth] GET error:', error)
    return NextResponse.json({ error: 'Internal auth error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const response = await handlers.POST(request)
    if (response) return response
    console.error('[auth] POST returned no response for', request.url)
    return NextResponse.json({ error: 'Auth handler returned no response' }, { status: 500 })
  } catch (error) {
    console.error('[auth] POST error:', error)
    return NextResponse.json({ error: 'Internal auth error' }, { status: 500 })
  }
}
