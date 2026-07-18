import { jsonResponse } from '@/lib/api/response'
import { NextResponse } from 'next/server'

const PLANETS = Array.from({ length: 55 }, (_, i) => `planet${i + 1}.png`)

export async function GET() {
  return jsonResponse(PLANETS)
}
