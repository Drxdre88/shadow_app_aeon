# Aeon Setup Guide

A world-class Gantt chart + Trello-style task management application with stunning glassmorphism UI.

---

## Quick Start (Development)

```bash
cd apps/aeon
npm install
cp .env.example .env.local
# Edit .env.local with your credentials
npm run dev
```

Open http://localhost:3000

---

## Environment Variables

### Required: Database (Neon Postgres)

1. **Create free Neon account:** https://neon.tech
2. **Create a new project** (any region works)
3. **Copy connection string** from Dashboard > Connection Details
4. **Add to `.env.local`:**

```env
DATABASE_URL="postgresql://username:password@ep-xxx.region.aws.neon.tech/aeon?sslmode=require"
```

### Required: Auth Secret

Generate a secure secret:

```bash
# Mac/Linux
openssl rand -base64 32

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Add to `.env.local`:

```env
AUTH_SECRET="your-generated-secret-here"
NEXTAUTH_URL="http://localhost:3000"
```

### Optional: OAuth Providers

#### Google OAuth

1. Go to https://console.cloud.google.com
2. Create new project or select existing
3. Navigate to APIs & Services > Credentials
4. Create OAuth 2.0 Client ID (Web application)
5. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID and Secret

```env
AUTH_GOOGLE_ID="your-client-id.apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="your-client-secret"
```

#### GitHub OAuth

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set Homepage URL: `http://localhost:3000`
4. Set Callback URL: `http://localhost:3000/api/auth/callback/github`
5. Copy Client ID and generate Client Secret

```env
AUTH_GITHUB_ID="your-client-id"
AUTH_GITHUB_SECRET="your-client-secret"
```

#### Magic Link (Resend)

1. Create account at https://resend.com
2. Get API key from dashboard
3. Add verified domain (or use sandbox for testing)

```env
AUTH_RESEND_KEY="re_xxxxxxxxxxxx"
EMAIL_FROM="Aeon <noreply@yourdomain.com>"
```

---

## Database Setup

After configuring DATABASE_URL, initialize the database:

```bash
# Generate migration from schema
npm run db:generate

# Push schema to Neon (for development)
npm run db:push

# Or run migrations (for production)
npm run db:migrate

# Open Drizzle Studio to view/edit data
npm run db:studio
```

---

## Project Structure

```
apps/aeon/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/auth/           # NextAuth API routes
│   │   ├── globals.css         # Global styles + glow utilities
│   │   ├── layout.tsx          # Root layout with theme provider
│   │   └── page.tsx            # Landing page
│   ├── components/
│   │   ├── ui/                 # Core UI (GlowCard, NeonButton, ThemeSelector)
│   │   ├── gantt/              # Gantt chart components
│   │   └── board/              # Kanban board components
│   ├── config/
│   │   └── themes.ts           # 6 color themes
│   ├── lib/
│   │   ├── db/                 # Drizzle schema + connection
│   │   ├── store/              # Zustand stores (gantt, board)
│   │   ├── utils/              # Helpers (cn, colors)
│   │   └── auth.ts             # NextAuth configuration
│   └── stores/
│       └── themeStore.ts       # Theme state with localStorage
├── drizzle/                    # Generated migrations
├── drizzle.config.ts           # Drizzle Kit config
├── tailwind.config.ts          # Tailwind + glow utilities
├── .env.example                # Environment template
└── package.json
```

---

## Themes

Aeon includes 6 stunning themes:

| Theme | Primary Glow | Style |
|-------|--------------|-------|
| Deep Space | Indigo/Violet | Dark cosmic |
| Aurora | Cyan/Teal | Northern lights |
| Ember | Orange/Amber | Warm fire |
| Midnight | Blue/Slate | Cool night |
| Forest | Emerald/Green | Natural |
| Rose | Pink/Rose | Elegant |

Switch themes using the theme selector in the top-right corner.

---

## Key Features

### Gantt Chart
- **Time scales:** Day (hourly), Week (daily), Month (weekly)
- **Drag to move:** Horizontal (time) and vertical (rows)
- **Glowing task bars** with customizable accent colors
- **Progress indicators** on each task

### Task Board (Kanban)
- **4 columns:** Todo, Doing, Review, Done
- **Drag-and-drop** between columns
- **Task cards** with labels, priority glows, and dates
- **Quick add** from any column

### Task-to-Gantt Conversion
- Add start/end dates to any board task
- Convert to timeline with one click
- Bi-directional sync

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:push` | Push schema to database |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open Drizzle Studio |

---

## Troubleshooting

### "DATABASE_URL environment variable is not set"
- Ensure `.env.local` exists with valid DATABASE_URL
- Restart dev server after changing env vars

### "Invalid OAuth redirect"
- Check callback URLs match exactly in provider settings
- Include protocol (http:// or https://)

### "Auth session not persisting"
- Ensure AUTH_SECRET is set
- Check database connection (sessions stored in DB)

### Neon cold start latency
- First request after idle may take 1-2 seconds
- Subsequent requests are fast
- Consider Neon's always-on compute for production

---

## Production Deployment

For Vercel deployment:

1. Connect GitHub repo to Vercel
2. Set environment variables in Vercel dashboard
3. Update NEXTAUTH_URL to production domain
4. Update OAuth callback URLs in provider settings

---

*Built with Next.js 15, React 19, Tailwind CSS, Framer Motion, Zustand, Drizzle ORM, and Neon Postgres*
