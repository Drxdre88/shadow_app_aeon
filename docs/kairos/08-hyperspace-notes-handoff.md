# Track B — Hyperspace + Notes UX

**Status:** spec drafted 2026-05-21. Implementation NOT started.
**Branch:** `feature/hyperspace-notes-ux` (cut from `feature/hyperspace_notes`).
**Time estimate:** 1 focused session.
**Parallel-safe with:** Track A (Cortex polish), Track C (AI integration). Touches different files.

This track owns the user-facing capture/review surface OUTSIDE the `/brain` Cortex view: the `/notes` page, dashboard widgets, and the Quick Capture overlay polish. The brain *graph* is someone else's track.

---

## 1. What's already live (don't rebuild)

- **`QuickCaptureOverlay`** (`apps/web/src/components/hyperspace/QuickCaptureOverlay.tsx`) — Cmd/Ctrl+Shift+Space global hotkey, glass overlay, Cmd+Enter saves via `createMemory` server action. Mounted globally in `app/layout.tsx`. Works.
- **`createMemory` server action** (`lib/actions/memories.ts`) — auth-guarded, validated, accepts title + body + tags + type + source + realm/project/task anchors.
- **`prepareContextForUser` server action** — calls the budget-packed markdown bundler. Use this for Daily Briefing.
- **Brain icon in sidebar** (`components/sidebar/AppSidebar.tsx`) — routes to `/brain`.
- **Cortex `/brain` route** — Track A is polishing the visuals.

---

## 2. What this track builds

### 2.1 `/notes` bento page (NEW route)

Route file: `apps/web/src/app/notes/page.tsx` + `apps/web/src/app/notes/layout.tsx`.

**Layout**: bento grid (CSS grid, not `react-grid-layout` — keep it simple). Each tile is a memory card. Tiles of varied sizes:
- 1×1: short notes (≤200 chars)
- 1×2: medium (200-800)
- 2×2: long (>800) or pinned

**Header**: search bar (FTS via `searchMemories` action) + filter chips (source / type / has-anchor / unanchored / pinned).

**Tile content**:
- Title (first line of bodyMd, truncated)
- Snippet (next ~3 lines)
- Footer row: source icon + relative timestamp + tags + realm/project chip if anchored
- Click → memory side panel slide-in (reuse `MemorySidePanel.tsx` from the brain components)
- Right-click → context menu: pin / promote-to-card / link / delete

**Empty state**: prompt the user to press ⌘⇧Space or hit the FAB.

**Data**: call `listMemoriesForUser({ limit: 100 })` server action. Don't paginate on page 1 — add infinite scroll later if memory count > 100.

### 2.2 Promote-to-card flow

When user right-clicks a memory tile and picks "Promote to card":

1. Open a modal with: project picker (call `listProjectsForUser`), column picker (depends on project — call `findColumnsForProject`), label picker.
2. On confirm: create a board task via the existing `createTask` server action with title from memory title, description from memory bodyMd, label as chosen.
3. Add a typed link back to the memory: call `addLinkToMemory(memoryId, { targetKind: 'task', target: newTaskId, type: 'refers_to' })`.
4. Toast: "Promoted to <Project> · <Column>" with a link.

This is the user's "thought → action" pipeline. It IS the differentiator vs other PKM apps.

### 2.3 Dashboard EOD reflection card

File: `apps/web/src/components/hyperspace/EodReflectionCard.tsx`.
Mount in: `apps/web/src/app/dashboard/DashboardContent.tsx`.

**Visibility rule**: render only after 18:00 local AND no memory of `type='reflection'` exists for today.

**Form**: three text fields:
- What happened today?
- What did I decide?
- What's still open?

**On submit**: single `createMemory` call with `type: 'reflection'`, `tags: ['eod', '<YYYY-MM-DD>']`, body joined with markdown headers. Auto-anchored to no realm/project (it's personal reflection).

After submit, replace the card with a small "EOD reflected ✓ — view in /brain" link.

### 2.4 Capture FAB (floating action button)

File: `apps/web/src/components/hyperspace/CaptureFab.tsx`.
Mount in: `apps/web/src/app/layout.tsx` (next to `<QuickCaptureOverlay />`).

Bottom-right floating button (z-index above content but below modals). Icon: `Plus` from lucide. Click → opens the same overlay as Cmd+Shift+Space. Mobile/touch users have this; keyboard users have the hotkey.

Hide on `/brain` (the capture rail is right there).

### 2.5 Daily Briefing card on dashboard

File: `apps/web/src/components/hyperspace/DailyBriefingCard.tsx`.
Mount in: `apps/web/src/app/dashboard/DashboardContent.tsx`.

On mount, if the user has memories (>0), call `prepareContextForUser({ query: "what should I focus on today", scopeRealmId: null, budgetTokens: 1500 })`. Render the returned markdown in a card with a clean prose style.

Cite block at the bottom shows the source memories — each click flies the camera to that node in the Cortex (router push to `/brain?focus=<memoryId>`).

Cache the briefing per day (`localStorage` keyed by `YYYY-MM-DD`) so it doesn't re-fetch every navigation.

### 2.6 Quick Capture polish (extend existing overlay)

Existing `QuickCaptureOverlay.tsx` is functional but minimal. Add:

- **Tag picker** — chip-row of recent tags (last 30 distinct from the user's memories). Click to add to the current capture.
- **Realm/project anchor** — small dropdown ("Anchor to: [None / current realm / current project]"). Defaults to None (truly personal).
- **Voice button** — placeholder for now; opens an "Use mic" pill. Track C will wire the actual STT.
- **Recent captures preview** — show the last 3 captures below the textarea so user has context.

---

## 3. Files to create

```
apps/web/src/app/notes/layout.tsx                              # dark glass layout, full bleed
apps/web/src/app/notes/page.tsx                                # bento grid entry
apps/web/src/components/notes/BentoGrid.tsx                    # CSS grid wrapper
apps/web/src/components/notes/NoteCard.tsx                     # single tile
apps/web/src/components/notes/NotesHeader.tsx                  # search + filter chips
apps/web/src/components/notes/PromoteToCardModal.tsx           # task creation flow

apps/web/src/components/hyperspace/CaptureFab.tsx              # floating + button
apps/web/src/components/hyperspace/EodReflectionCard.tsx       # dashboard EOD widget
apps/web/src/components/hyperspace/DailyBriefingCard.tsx       # dashboard prepare_context surface
```

## 4. Files to modify

```
apps/web/src/components/hyperspace/QuickCaptureOverlay.tsx     # +tags +anchor +recent captures
apps/web/src/app/layout.tsx                                    # +<CaptureFab/>
apps/web/src/app/dashboard/DashboardContent.tsx                # +<EodReflectionCard/> +<DailyBriefingCard/>
apps/web/src/components/sidebar/AppSidebar.tsx                 # +Notes icon next to Brain
```

## 5. Server actions you'll need (all exist)

- `createMemory` — capture
- `updateMemory` — pin, tag edit, anchor change
- `deleteMemoryById` — delete
- `listMemoriesForUser` — bento grid
- `searchMemories` — header search bar
- `prepareContextForUser` — daily briefing
- `addLinkToMemory` — promote-to-card writes back a `refers_to` link
- `createTask` from `lib/actions/board.ts` — promote-to-card creates the task

## 6. URL state

`/notes` accepts query params:
- `?q=<text>` — pre-fills search
- `?source=manual,voice` — pre-filters sources
- `?type=note,reflection` — pre-filters types
- `?focus=<memoryId>` — opens side panel immediately

`/brain?focus=<memoryId>` — used by Daily Briefing citations. Implement focus in Track A or Track B (whichever lands first; coordinate via PR comment).

## 7. Architectural rules

- **No new server actions or routes.** Everything you need exists. If you find yourself wanting one, comment in PR and discuss before adding.
- **Tag values must be unique per user.** When showing recent tags in Quick Capture, query distinct via `listMemoriesForUser` and flatten.
- **Promote-to-card must always add a `refers_to` link** back from memory to task — without it the user loses the breadcrumb.
- **Empty states matter.** Every list view ("no memories yet", "no tags yet", "no matches") gets a sentence + a hint at the action that fills it.

## 8. Acceptance

- [ ] `/notes` route loads, shows all memories as bento tiles
- [ ] Search + filter chips work
- [ ] Tile click opens side panel; right-click opens context menu
- [ ] Promote-to-card creates a task AND writes a `refers_to` link
- [ ] FAB appears on every page except `/brain`
- [ ] FAB click + ⌘⇧Space both open the same overlay
- [ ] Quick Capture has recent-tags chips, anchor dropdown, last-3 preview
- [ ] EOD card shows after 18:00 local; hides after reflection submitted
- [ ] Daily Briefing card renders markdown from `prepare_context`; citations fly camera to node in Cortex
- [ ] All 1561 existing tests still pass
- [ ] Typecheck + lint clean

## 9. Out of scope

- Voice STT — Track C
- Auto-categorisation of capture tags — Track C
- Memory editing inline (just the side panel for now)
- Bulk delete / archive
- Export to markdown file (`/api/v1/memories/[id]/export` already exists if needed)
- Real-time sync between tabs (Pusher) — Phase 5 of brain roadmap

## 10. Reference + boot

```bash
cd C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon
git checkout feature/hyperspace_notes
git checkout -b feature/hyperspace-notes-ux

# Required reading before code:
cat docs/brain/08-hyperspace-notes-handoff.md    # this file
cat docs/brain/06-cortex-design.md               # original spec for the overall vision
cat CLAUDE.md
ls apps/web/src/components/hyperspace/           # see what already exists
ls apps/web/src/app/dashboard/                   # where widgets mount
ls apps/web/src/lib/actions/                     # available actions

npm run dev --workspace=apps/web
# Build the /notes route first — easiest standalone slice. Then dashboard widgets. Then QuickCapture polish.
```
