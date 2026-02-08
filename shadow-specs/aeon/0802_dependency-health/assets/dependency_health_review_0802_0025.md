# AEON Dependency Health Review
**Date:** 2026-02-08
**Analyst:** shadow-judge

## Dependency Version Matrix

| Package | Installed | Latest Stable | Status |
|---------|-----------|--------------|--------|
| next | 16.1.4 | 16.1.6 | Minor patch behind |
| next-auth | 5.0.0-beta.25 | beta.30 (no stable v5) | BETA - 5 versions behind tip |
| react / react-dom | 19.0.0 | 19.0.0 | Current |
| drizzle-orm | 0.37.0 | 0.45.1 | 8 minor versions behind |
| drizzle-kit | 0.30.6 | 0.31.8 | VULNERABLE - upgrade required |
| @auth/drizzle-adapter | 1.11.1 | 1.11.1 | Current |
| @neondatabase/serverless | 0.10.4 | 1.0.2 | Major version behind |
| framer-motion | 11.18.2 | 12.33.0 | Major version behind |
| lucide-react | 0.468.0 | 0.563.0 | ~95 versions behind |
| zustand | 5.0.10 | 5.0.11 | Current |
| resend | 4.8.0 | 6.9.1 | 2 major versions behind |
| date-fns | 4.1.0 | 4.1.0 | Current |
| tailwindcss | 3.4.19 | 4.1.18 (v3 LTS: 3.4.19) | Current on v3 LTS |
| dotenv | 17.2.3 | 17.2.4 | Current |
| typescript | 5.9.3 | 5.9.3 (range) | Current |
| @dnd-kit/core | 6.3.1 | 6.3.1 | Current |
| @dnd-kit/sortable | 8.0.0 | 10.0.0 | Major version behind |

## 1. Critical Peer Dependency Conflict (--legacy-peer-deps Root Cause)

**The single blocker:** `next-auth@5.0.0-beta.25` declares:
```
peer next: "^14.0.0-0 || ^15.0.0-0"
```

The project uses `next@16.1.4`, which is NOT in that peer range. This is the ONLY reason `--legacy-peer-deps` is required.

**Fix:** Upgrade to `next-auth@5.0.0-beta.30`, which declares:
```
peer next: "^14.0.0-0 || ^15.0.0 || ^16.0.0"
```

beta.30 explicitly adds Next.js 16 support. This single change eliminates the need for `--legacy-peer-deps`.

## 2. next-auth v5 Stable Release Status

**There is NO stable v5 release.** The dist-tags show:
- `latest`: 4.24.13 (v4 stable)
- `beta`: 5.0.0-beta.30 (latest beta)

The v5 beta has been in beta since 2023. The Auth.js team has not cut a stable release. beta.30 is the most current and is the version that adds Next.js 16 peer dep support. The project MUST use beta regardless -- upgrading to beta.30 is the correct move.

## 3. drizzle-orm + @neondatabase/serverless Compatibility

**Current:** drizzle-orm@0.37.0 + @neondatabase/serverless@0.10.4
**Both drizzle-orm 0.37 and 0.45.1 require:** `@neondatabase/serverless >= 0.10.0`

The original conflict with `@neondatabase/serverless ^1.0.2` was NOT a peer dep conflict with drizzle-orm -- drizzle accepts `>=0.10.0`. The conflict was likely an API breaking change in the neon driver v1.0 (it shifted to a full pg-compatible API and changed internal type exports).

**However:** The exports structure is identical between 0.10.4 and 1.0.2 (`{ import, require }`), and the `neon()` HTTP function used in `src/lib/db/index.ts` is preserved in v1.0.2. The `drizzle-orm/neon-http` driver should work with both.

**Recommended combination:** drizzle-orm@0.45.1 + @neondatabase/serverless@1.0.2 + drizzle-kit@0.31.8

This is safe because:
- drizzle-orm peerDep: `@neondatabase/serverless >= 0.10.0` (1.0.2 satisfies)
- The `neon()` export used for HTTP queries is preserved in v1.0.2
- drizzle-kit@0.31.8 fixes the esbuild vulnerability

## 4. Security Vulnerabilities

**npm audit found 3 moderate vulnerabilities**, all from the same chain:
```
esbuild <= 0.24.2 (GHSA-67mh-4wv8-2f99)
  -> @esbuild-kit/core-utils
    -> @esbuild-kit/esm-loader
      -> drizzle-kit@0.30.6
```

**CVE:** esbuild enables any website to send requests to dev server and read responses (CVSS 5.3, moderate).

**Fix:** Upgrade drizzle-kit to 0.31.8, which drops the vulnerable esbuild-kit dependency.

## 5. Middleware Deprecation in Next.js 16

The current `src/middleware.ts` uses the standard middleware convention (`export function middleware()` + `export const config`). Based on my knowledge through May 2025, Next.js 15 introduced discussions about a "proxy" convention but it was NOT finalized or shipped as a replacement for middleware by that date.

Next.js 16.1.4 (current) still supports the middleware.ts pattern. The "proxy" concept was part of RFC discussions for intercepting/rewriting requests at the edge, but the standard `middleware.ts` convention remains the primary supported pattern.

**Recommendation:** No action needed currently. The middleware.ts pattern is still functional. Monitor Next.js 16.x changelogs for any formal deprecation notice. If warnings appear in dev console, they would provide the migration path.

## 6. resend Major Version Gap

resend jumped from v4 to v6 (skipping v5). Current installed: 4.8.0, latest: 6.9.1. This is a 2-major-version gap that likely includes breaking API changes. The project uses Resend for email via next-auth providers -- check if the next-auth Resend provider is compatible with resend@6.

## 7. framer-motion v11 -> v12

framer-motion jumped to v12 (currently 12.33.0). This is a major version with potential breaking changes (renamed components, changed APIs). Since the project likely uses basic animation features, this upgrade should be evaluated but is not urgent.

## 8. @dnd-kit/sortable v8 -> v10

@dnd-kit/sortable@10.0.0 has peer dep `@dnd-kit/core@^6.3.0` (satisfied). The upgrade from v8 to v10 skipped v9 and may include breaking API changes in sortable strategies/hooks.

## Concrete Upgrade Path

### Phase 1: Critical (eliminates --legacy-peer-deps and fixes vulnerabilities)
```json
{
  "next-auth": "5.0.0-beta.30",
  "drizzle-kit": "^0.31.8"
}
```
After this change, `npm install` should work WITHOUT `--legacy-peer-deps`.

### Phase 2: Recommended (stay current on stable releases)
```json
{
  "next": "^16.1.6",
  "drizzle-orm": "^0.45.1",
  "@neondatabase/serverless": "^1.0.2",
  "lucide-react": "^0.563.0"
}
```
**Note on drizzle-orm 0.37 -> 0.45:** This is a significant jump. Review the drizzle-orm changelog for any schema definition API changes. The `pgTable` API used in `schema.ts` should be stable, but the compound key syntax with the callback API may have shifted.

### Phase 3: Evaluate (major version bumps requiring testing)
```json
{
  "framer-motion": "^12.33.0",
  "@dnd-kit/sortable": "^10.0.0",
  "resend": "^6.9.1"
}
```
Each of these is a major version change. Test individually.

### Phase 4: Future consideration (large migration)
```json
{
  "tailwindcss": "^4.1.18"
}
```
Tailwind v4 is a complete rewrite (CSS-first config, no tailwind.config.ts). This is a significant migration effort. Staying on v3 LTS (3.4.19) is fine for now.
