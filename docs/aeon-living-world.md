# Aeon living world — keeping Aeon current

Aeon changes fast: models get replaced, features get retired, the architecture moves. The
**freshness check** spots where Aeon has fallen behind, so the help guides, the architecture
docs and the model list stay up to date. It only reads and reports — it never edits code and
**never upgrades dependencies**.

## Run it

```bash
npm run freshness                          # full report (includes `npm outdated`, ~30–60 s)
npm run freshness -- --skip-deps           # fast, offline (< 1 s): skip dependency drift
npm run freshness -- --out report.md       # also write the Markdown report to a file
npm run freshness -- --strict              # exit 1 if any 🔴 finding (for release gates)
npm run test:freshness                     # unit tests for the rules (node:test)
```

The report ends with a summary line: `🟢 n · 🟡 n · 🔴 n`. Code: `scripts/aeon-freshness.mjs`
(IO) and `scripts/freshness/lib.mjs` (pure rules, tested in `scripts/__tests__/`).

## What it checks and what to do

| Section | Check | 🟡 / 🔴 | What to do |
|---|---|---|---|
| **Models** | `packages/shared/src/ai/model-registry.json`: `reviewedAt` age; legacy models still used in `defaults`; model-id string literals (`claude-*`, `gpt-*`, `gemini-*`, `o<n>`) in `apps/web/src`, `apps/kairos-worker/src`, `aeon_os/workflows` (tests and `results/` excluded) that the registry doesn't know | 🟡 > 45 days, 🔴 > 90; 🟡 for legacy defaults / unregistered literals | Check each vendor's current model docs (web research — don't trust memory), update the registry and set `reviewedAt` to today, move code onto registered ids, run the tests. |
| **Help guides & docs** | Phrases listed in `scripts/freshness/retired-terms.json` (retired features, old names, old model ids) found in user-facing guides: `components/**/*Guide*`, `components/kairos/brain/**`, `components/ui/help/**`, `app/settings/**`, Kairos docs 25/33/34, `apps/web/docs/**`, `CLAUDE.md`, `README*.md`, `architecture/**` | 🟡 per hit (`file:line`) | Rewrite the stale text. History is fine in changelogs and `architecture/history.md` (allow-listed). A line that deliberately records a retirement can say "retired" or carry `freshness-ignore`. A model id the registry lists as current is never flagged. Add newly retired phrases to the JSON when you retire a feature. |
| **Architecture docs** | Newest date in `architecture/history.md` vs the newest `feat(`/`fix(` commit touching `apps/`; top-level `lib/*` and `app/api/*` folders never mentioned in `architecture/**/*.md` | 🟡 > 14 days behind, 🔴 > 30; 🟡 for unmentioned folders | Run the **inferno-cartographer** skill to refresh the architecture set. |
| **Versions & changelogs** | `lib/version.ts` = top of `CHANGELOG.md` = top of `lib/changelog.ts`; `lib/kairos/version.ts` = top of `docs/kairos/CHANGELOG.md` | 🔴 on mismatch | Fix the version bump so all agree. |
| **Dependencies** — *report only* | `npm outdated --json --workspaces`: majors / minors behind, plus key packages (next, react, ai, @ai-sdk/*, drizzle-orm, next-auth, typescript, vitest) current → latest | 🟡 if a key package is a major behind; never 🔴 | **Report to the owner. Never upgrade without the owner's explicit go.** |
| **Routines & brain** | BRAIN_JOBS ↔ PLANNED_THINKING_KINDS | — | Already locked by `planned-kinds.test.ts`; noted as covered. |

## Cadence

- **Weekly:** `.github/workflows/freshness.yml` runs Mondays 06:30 UTC (and on demand via
  *Run workflow*). While anything is 🟡/🔴 it keeps one open issue, **"Aeon living world —
  freshness report"** (label `freshness`), updated with the latest report; it closes the issue
  when everything is green. The workflow is read-only apart from that issue.
- **Before each release:** run `npm run freshness -- --strict` and clear the 🔴s.
- **In a session:** the `aeon-living-world` skill walks the whole procedure (models → guides →
  architecture → dependency report).
