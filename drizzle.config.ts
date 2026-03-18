import 'dotenv/config'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { defineConfig } from 'drizzle-kit'

neonConfig.webSocketConstructor = ws

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
