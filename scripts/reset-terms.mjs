import dotenv from 'dotenv'
dotenv.config({ path: './apps/web/.env.local' })
dotenv.config({ path: './apps/web/.env' })

import { neonConfig, Pool } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const result = await pool.query(`UPDATE users SET terms_accepted_at = NULL`)
console.log(`Reset terms for ${result.rowCount} user(s)`)
await pool.end()
