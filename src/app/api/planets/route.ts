import { NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import { join } from 'path'

export async function GET() {
  const dir = join(process.cwd(), 'public', 'planets')
  try {
    const files = await readdir(dir)
    const images = files.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort()
    return NextResponse.json(images)
  } catch {
    return NextResponse.json([])
  }
}
