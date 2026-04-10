import { cache } from 'react'
import NextAuth from 'next-auth'
import type { Provider } from 'next-auth/providers'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import Google from 'next-auth/providers/google'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { hasValidPendingInvite, resolveUserPendingInvites } from '@/lib/data/workspaces'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      termsAccepted: boolean
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_EMAILS) {
  console.warn('[auth] ALLOWED_EMAILS is not set — registration is open to everyone')
}

function buildProviders(): Provider[] {
  const providers: Provider[] = []

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      })
    )
  }

  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    const GitHub = require('next-auth/providers/github').default
    providers.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
      })
    )
  }

  if (process.env.AUTH_RESEND_KEY) {
    const Resend = require('next-auth/providers/resend').default
    providers.push(
      Resend({
        apiKey: process.env.AUTH_RESEND_KEY,
        from: process.env.EMAIL_FROM || 'Aeon <noreply@aeon.app>',
      })
    )
  }

  return providers
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const nextAuth = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: 'database', maxAge: SESSION_MAX_AGE_SECONDS },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_MAX_AGE_SECONDS,
      },
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: buildProviders(),
  events: {
    createUser: async ({ user }) => {
      const adminEmails = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean)
      if (user.email && user.id && adminEmails.includes(user.email)) {
        await db
          .update(schema.users)
          .set({ role: 'admin' })
          .where(eq(schema.users.id, user.id))
      }
      if (user.id && user.email) {
        await resolveUserPendingInvites(user.id, user.email).catch((err) =>
          console.error('[auth] resolveUserPendingInvites failed for', user.email, err)
        )
      }
    },
  },
  callbacks: {
    signIn: async ({ user }) => {
      const allowed = (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean)
      if (allowed.length === 0) return true
      if (!user.email) return false
      if (allowed.includes(user.email)) return true
      return hasValidPendingInvite(user.email)
    },
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
        role: (user as unknown as Record<string, unknown>).role as string || 'user',
        termsAccepted: !!(user as unknown as Record<string, unknown>).termsAcceptedAt,
      },
    }),
  },
})

export const { handlers, signIn, signOut } = nextAuth
export const auth = cache(nextAuth.auth)
