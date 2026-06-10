# Clean Session Capture (P1)

**Status:** shipped 2026-06-06
**Scope:** `apps/web/scripts/claude-session-capture.mjs`
**Supersedes the title/summary behaviour described in:** doc 05 §5 (the rest of doc 05 — install, hook registration, env, troubleshooting — still stands).

The capture hook fires at `SessionEnd` and POSTs a `session_summary` memory for every Claude Code session you finish, across every repo. P1 is a quality pass on **what** it stores: the raw transcript is now sanitised before it touches the brain, noise-only openers are dropped, and the human-readable `summary` + `execSummary` are pulled from the assistant's own **## Executive Summary** instead of from the first prompt.

---

## Why this exists — the before/after

The hook used to take the **first user message verbatim** and shove it into both the memory `title` and `summary`. In practice the first message is rarely the work — it's harness noise:

- `<system-reminder>` blocks (project CLAUDE.md, available skills, memory index — thousands of chars)
- slash-command wrappers (`<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`)
- pasted tool output the operator dropped in (lines starting with `⎿`)
- a bare `/some-skill` invocation with no prose at all

So the brain filled up with memories titled `shadow_app_aeon: <system-reminder> As you answer the user's questions…` and a `summary` that was a wall of reminder text. Searching it was useless and the cosmic-view labels were unreadable.

| | Before | After |
|---|---|---|
| `title` subject | first 60 chars of raw first message (often a reminder block) | first 60 chars of the **sanitised** first real message |
| `summary` | first prompt truncated to 240 chars | the assistant's **Executive Summary** prose (falls back to first prompt only if there's no summary) |
| `execSummary` | not populated | bullet list parsed from the Executive Summary's **Key points** |
| noise-only first message | stored as-is | skipped; the next real message is used instead |

The fix is all client-side. The server still stores whatever it receives — there is no LLM on the write path.

---

## 1. Sanitisation — `sanitizeCapturedText()`

Runs on every candidate user message before it's considered "the first prompt". In order:

1. Strip `<system-reminder>…</system-reminder>` blocks (multiline, case-insensitive).
2. Strip the four command-wrapper tags **and their content**: `command-name`, `command-message`, `command-args`, `local-command-stdout` (paired form), plus any stray lone/self-closing tags.
3. Drop any line whose trimmed form starts with `⎿` (pasted tool-output rows).
4. Collapse 3+ consecutive blank lines down to 2, then `trim()`.

The function is deliberately conservative — it removes known harness artefacts, not arbitrary markup, so real user prose is never mangled.

## 2. Skipping noise-only openers — `extractFirstUserMessage()`

The extractor walks user messages in order and runs each through `sanitizeCapturedText()`. The **first one that has non-empty content after cleaning** wins. A message that was *entirely* a reminder or a bare slash command sanitises down to an empty string and is skipped, so the captured subject is the operator's first actual instruction, not the harness preamble.

## 3. Deriving `summary` + `execSummary` from the Executive Summary

Two pure helpers parse the **last assistant message** (the wrap-up turn):

- **`extractExecutiveSummary(assistantText)`** — finds a heading matching `^#{2,}\s*executive summary\s*$` (case-insensitive) and returns the block up to the next `##` heading. Returns `''` when there's no such heading.
- **`parseExecBullets(execSummaryText)`** — pulls `-`/`*` bullet lines out of that block, stripping the marker and any leading bold label like `**Key points:**`, capping each bullet at 200 chars and the list at 10.

Then in `buildPayload()`:

```text
execText  = extractExecutiveSummary(lastAssistant)
summary   = execText ? truncate(execText, 240) : truncate(firstPrompt, 240)   // graceful fallback
bullets   = parseExecBullets(execText)
execSummary = bullets.length ? bullets : (field omitted)
```

This is why the **mandatory end-of-answer Executive Summary** in CLAUDE.md pays off twice: it's good for the operator reading the chat *and* it becomes the memory's summary + bullet digest for free. Sessions that don't end with one still capture cleanly — they just fall back to the first prompt for `summary` and omit `execSummary`.

---

## What a captured memory looks like now

| Field | Value |
|---|---|
| `title` | `<repo>: <first 60 chars of the first REAL prompt>` |
| `summary` | Executive-Summary prose (≤240 chars), or first prompt as fallback |
| `execSummary` | `string[]` of Key-points bullets (omitted when no Executive Summary) |
| `bodyMd` | Session stats · First user prompt · Files touched · Commits · Final assistant excerpt |
| `type` / `source` | `session_summary` / `claude` |
| `sourceMetadata` | repo, branch, remote, sessionId, cwd, hookEvent, endReason, projectName, realmName, filesTouched[], commits[], stats{} |

`title` still uses the first 60 chars of the (now-clean) first prompt rather than the Executive Summary — the opener is a better *subject line*, the summary is a better *description*. `aiTitle` + a richer `execSummary` are still available via the opt-in `BRAIN_AI_CLEANUP=1` path (an extra `claude --print` call), unchanged by this work.

---

## Verifying the cleanup

Dry-run against any real transcript and eyeball the payload:

```bash
TRANSCRIPT=$(ls ~/.claude/projects/*/*.jsonl | head -1)
echo "{\"session_id\":\"t\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"hook_event_name\":\"SessionEnd\",\"reason\":\"test\"}" \
  | BRAIN_DRY_RUN=1 BRAIN_DEBUG=1 node apps/web/scripts/claude-session-capture.mjs
```

Check that `title` is a real instruction (no `<system-reminder>`), `summary` reads like the Executive Summary, and `execSummary` is a clean bullet list. Pick a transcript whose session ended with an Executive Summary to exercise the happy path.

---

## Notes / gotchas

- **Sanitisation only touches the *first-prompt* extraction.** The `bodyMd` "First user prompt" section uses the same cleaned text, but the "Final assistant excerpt" is stored raw (it's the model's own output, no harness noise to strip).
- **The Executive-Summary parse is heading-anchored**, not position-anchored. If a session has multiple `## Executive Summary` headings (rare — multiple wrap-ups), the **first** match wins and the block ends at the next `##`.
- **No server change.** Idempotency is still by `sessionId` (`createMemory` short-circuits a re-post), so re-running the hook or the `--backfill` pass over an old transcript safely re-captures with the improved fields only if the row doesn't already exist. To *re-clean* already-captured junk rows you'd archive them and re-run backfill.
- **Backfill inherits the cleanup for free** — `--backfill` runs the same `processSession()` → `buildPayload()` path, so any newly-captured historical sessions get clean titles/summaries too.
