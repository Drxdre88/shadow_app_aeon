import { NextRequest } from 'next/server'
import {
  authenticateRequest,
  isApiUser,
  apiHandler,
  jsonData,
} from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        image: users.image,
      })
      .from(users)
      .where(eq(users.id, result.id))
      .limit(1)

    if (!user) return jsonData(null)
    return jsonData(user)
  }),
  API_READ_LIMIT
)
