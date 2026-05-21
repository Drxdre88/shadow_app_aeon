# Aeon Brain — `/brain` (Cortex) screen + Hyperspace capture surface

**Status:** spec drafted 2026-05-21 — no code yet on this branch.
**Branch:** `feature/hyperspace_notes` (this one) — picks up Hyperspace capture + the new Cortex screen.
**Parallel branch:** `feature/brain_phase4` (pushed, PR-ready, **not merged**) — adds `prepare_context` MCP/REST + SessionStart backfill.
**Visual lodestars:**
- `C:/Users/anselikhov/OneDrive - SEFE Securing Energy for Europe GmbH/Desktop/imges/aeon/neurons.png` — the cluster-by-region neural-net look we are targeting.
- `C:/Users/anselikhov/OneDrive - SEFE Securing Energy for Europe GmbH/Desktop/imges/swarm/swarm_v_mode.png` — confirms the bloom-heavy cosmic aesthetic to inherit.

---

## 1. Where the brain is *right now* (read before building)

### Live on `main` (merged PR #50)
- `memories` table + tsvector + GIN indexes (migration `apps/web/drizzle/0013_brain_memories.sql`)
- `lib/data/memories.ts` — CRUD + FTS + 1-2 hop graph walk
- `lib/actions/memories.ts` — auth-guarded server actions
- 7 REST routes under `/api/v1/memories/*`
- 4 MCP tools: `create_memory`, `search_memories`, `link_memory`, `get_memory_with_neighbours`
- Markdown round-trip export
- `apps/web/scripts/claude-session-capture.mjs` — `SessionEnd` hook script
- `~/.claude/settings.json` already wires the `SessionEnd` hook for the user

### Pushed on `feature/brain_phase4` (NOT merged)
- `prepare_context` (5th MCP tool + REST `/api/v1/memories/context`)
  - Algorithm: BM25 (top 30) + 1-hop typed graph walk in parallel from top-10 + pinned + composite scoring (base × recency-decay) → budget-packed markdown (Pinned ≤30% / Most-relevant ≤55% / Related summaries / Sources block)
- `claude-session-capture.mjs --backfill` mode — scans `~/.claude/projects/<dir>/*.jsonl` in last 48h, dedupes via server-side idempotency, posts missed sessions
- `createMemory` idempotent by `sourceMetadata.sessionId` for `source='claude'` (re-POST is a no-op)
- `~/.claude/settings.json` already wires the `SessionStart` backfill on both `startup` and `resume` matchers
- `apps/web/.env.local` has `AEON_BASE_URL=https://aeon.shadow-lab.ai` so capture works regardless of dev server state

**Action item for next session:** open the PR for `feature/brain_phase4` and merge it before building the Cortex screen — the Cortex's daily-briefing CTA depends on `prepare_context`.

### Not built yet
- `/brain` route in Aeon (this doc's main subject)
- Quick Capture overlay (Cmd/Ctrl+Shift+Space)
- `/notes` bento destination + promote-to-card
- Dashboard memory widgets (EOD prompt, FAB)
- `/eod` slash-command skill in `~/.claude/skills/`
- Voice STT/TTS (Phase 5 of brain roadmap)

---

## 2. The vision — Cortex screen

A single SOTA-grade `/brain` route. **One page, three zones, zero tabs.** The visualization is the hero; capture options are always one click away; tracking is glanceable.

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⌕ "what was I thinking about RAG last week?"        [⚙] [⋮] [×]    │
├──────────┬──────────────────────────────────────────┬───────────────┤
│          │                                          │  TODAY        │
│ CAPTURE  │      ✦  ✦                                │  ─ 7 captures │
│          │    ✦  ✶  ✦                               │  ─ EOD done   │
│ [● TALK] │  ✦ ✶ ◉━━━━◉ ✦  ← the Cortex              │               │
│          │     ╲╱ ◉ ╲╱                              │  PINNED       │
│ [+ NOTE] │  ✦  ◉   ✶  ✦                             │  ─ Aeon vis…  │
│          │     ✶  ✦                                 │  ─ Swarm v3   │
│ [✎ EOD]  │                                          │               │
│          │  (3D R3F force graph, glowing,           │  STREAK 12d   │
│ ⌘⇧Space  │   idle-orbit, click-to-fly camera)       │  THIS WEEK    │
│          │                                          │  ─ realm pie  │
│ [🎯 PIN] │                                          │  ─ velocity ↗ │
│ [🔗 LINK]│                                          │               │
└──────────┴──────────────────────────────────────────┴───────────────┘
                                          (node click → side panel)
```

### Zone 1 — The Cortex (centre, hero)

**3D force-directed graph of every memory the user owns**, rendered via [`r3f-forcegraph`](https://github.com/vasturiano/r3f-forcegraph). Visual targets pulled directly from `neurons.png`:

- **Each node = a memory.** Sphere geometry (mesh + halo, same triple-layer pattern as `swarm_app/.../ReactorOrbPlanets.tsx`). Size scales with linkedness.
- **Cluster-by-realm.** Force simulation gets a per-realm centring force so memories naturally group by realm. Matches the red/orange-yellow-blue zoning visible in `neurons.png`.
- **Each edge = a typed link.** Colour-coded:
  - `supports` → emerald `#10b981`
  - `contradicts` → rose `#f43f5e`
  - `refers_to` → slate `#cbd5e1`
  - `relates` → sky `#38bdf8`
  - `supersedes` → violet `#a855f7`
  - `blocks_thinking` → amber `#f59e0b`
- **Realm tint.** Each memory's halo inherits the realm planet colour (10% saturation) so the eye groups by colour zone exactly like `neurons.png`.
- **Recency glow.** Memories from the last 24h glow stronger (emissive multiplier 1.4×); decays exponentially over 14 days. Aligns visually with `prepare_context`'s 14-day recency half-life.
- **Idle camera orbit** — slow Y-axis rotation when no interaction for 8s. The brain feels alive.
- **Live-capture animation.** New memory POST → Pusher event on `user-${userId}` channel → graph appends node with a brief scale-in (0.0 → 1.0 over 600ms) + edge ripple to any new siblings sharing tags/realm/recent session. *This is the moment that sells the product.*
- **Click node** → side panel slides in (Framer Motion `x: 400 → 0`), full body + neighbours highlighted via selective bloom, edit/pin/link/delete actions.
- **Hover** → drei `<Html>` floating tag with title + age + degree count (mirror the cockpit label style in `swarm_app/.../ReactorOrbPlanets.tsx:185-209`).
- **Right-click** → context menu: "find related" (orbit camera around the node + its 1-hop), "promote to canvas", "link to task…".
- **Filter chips above the canvas** — realm, type, source, time range, pinned-only. Graph reshapes morphically with `d3-force` re-tick. Respects the user's design principle: *"morphism over rigidity, fluid grouping, no locked-in structures"* (memory: `user_design_philosophy.md`).

### Zone 2 — Capture rail (left, always visible)

The "options for recording memories" the user asked for. Always one click away.

| Button | What it does | Writes via |
|---|---|---|
| **● Talk** | Pulse-animating mic. Web Speech API → live transcript → auto-create memory with optional Haiku polish pass | `create_memory` MCP / REST, `source='voice'` |
| **+ Note** | Inline textarea, no modal. Cmd+Enter saves | `create_memory`, `source='manual'` |
| **✎ EOD reflect** | Three-field prompt: *what happened · what did I decide · what's open*. Tagged `eod`, `YYYY-MM-DD` | `create_memory`, `type='reflection'` |
| **⌘⇧Space hint** | Persistent shortcut reminder. Global overlay still works here — captures land in context | shared component with Hyperspace overlay |
| **🎯 Pin from current** | When a node is focused, this pins it. Pinned items always surface in `prepare_context` | `PATCH /api/v1/memories/[id]` |
| **🔗 Link mode** | Toggles graph into edit mode: drag from one node to another → typed-edge picker → `link_memory` | `link_memory` MCP / REST |

**Every capture button writes through the existing Brain REST / MCP — no backend changes needed.** The Cortex screen is purely a presentation + capture surface on top of what's already shipped.

### Zone 3 — Tracking rail (right, glanceable)

The "track stuff" requirement, kept noiseless:

- **Today** — capture count + EOD reflected? (binary)
- **Pinned** — scrollable list, click → fly camera to that node
- **Streak** — consecutive days with ≥1 capture (small gamification)
- **This week** — realm distribution donut + velocity sparkline
- **Recent captures** — last 5 with source icon: 🤖 hook, 🎙️ voice, ⌨️ manual, ✎ eod
- **Suggested links** — heuristic suggestions (shared tag/realm/session) → 1-click accept
- **Daily Briefing card** — button that calls `prepare_context("what should I focus on today")` → renders the returned markdown, cited sources fly the camera

### The signature moment

User opens `/brain`. Camera idle-orbits the Cortex. They hit **● Talk** and say *"remind me what we decided about RAG bifurcation."* Three things happen simultaneously:

1. Mic pulses, transcript streams under it
2. Behind it, `prepare_context` fires on the transcribed text — relevant nodes **bloom brighter** via SelectiveBloom, edges pulse along walked paths
3. A side panel slides in with the markdown bundle from `prepare_context` — cited sources clickable, click any to fly the camera to that node

**Voice in → graph highlights → markdown context out, all in one fluid sequence.** This is the lane no one else is in.

---

## 3. Tech stack — picked, justified

| Need | Pick | Why |
|---|---|---|
| 3D scene | `@react-three/fiber` + `three` | Already used in `shadow_app_swarm` — reuse Planet.tsx + ReactorOrbPlanets.tsx patterns directly. Glow techniques (additive blending, depthWrite false, toneMapped false, triple-layer halo) lift cleanly. |
| Force-directed layout | [`r3f-forcegraph`](https://github.com/vasturiano/r3f-forcegraph) | R3F wrapper around `three-forcegraph` (vasturiano's mature lineage). Configurable dimensions (2D/3D), particle line rendering, GPU-friendly. |
| Bloom | `@react-three/postprocessing` `<Bloom>` + `<SelectiveBloom>` | Default luminanceThreshold=1 means only emissive materials glow → easy to control. SelectiveBloom for the "node bloom on context hit" moment. [docs](https://docs.pmnd.rs/react-postprocessing/effects/bloom) |
| Capture UI animations | `framer-motion` | Already in repo. Panel slides, mic pulse, FAB. |
| Voice STT/TTS | Web Speech API | Free, browser-native, Phase 5 of brain roadmap already specs it. Chrome/Edge/Android-PWA full; iOS Safari fallback = tap-to-dictate keyboard. |
| Live updates | Pusher subscription on `user-${userId}` channel | The Brain Phase 1 spec already stubbed this. Listener wired into the Cortex (and only the Cortex) lights up live-capture animations. |
| Data spine | Existing `prepare_context` + `search_memories` + `create_memory` MCP/REST | Zero new backend. After Phase 4 merges, all three are live. |

**Scale ceiling.** `r3f-forcegraph` handles up to ~5k nodes smoothly. The user will hit that in years, not months. If/when we cross it, drop the layout to [`cosmos.gl`](https://github.com/cosmosgl/graph) (formerly Cosmograph) — GPU-shader force layout, handles 1M+ nodes. Keep this in mind for the data hook abstraction.

---

## 4. Hyperspace capture surface (the prerequisite)

Two pieces of Hyperspace ship *before* the Cortex, because the Cortex's capture buttons reuse the same component:

### A. Global Quick Capture overlay
- `apps/web/src/components/hyperspace/QuickCaptureOverlay.tsx`
- Cmd/Ctrl+Shift+Space global listener registered on root layout
- Framer Motion floating overlay (centred, glass aesthetic matching Aeon)
- Textarea + Cmd+Enter submit → `createMemory` server action
- Auto-tags with current realm context if user is on a project page
- **Reused by `/brain` Cortex screen's `+ Note` button** — single shared component

### B. `/notes` bento destination
- New route `apps/web/src/app/notes/page.tsx`
- Bento-grid component (CSS grid or `react-grid-layout`), no columns
- Right-click promote → project + column picker → calls `create_task`
- Captures from Quick Capture land here as the inbox

### C. Aeon dashboard widgets
- **EOD reflection card** on `/dashboard`, surfaces after 18:00 local. Three text fields.
- **Persistent floating Capture FAB** in app shell (bottom-right). Opens same overlay as the hotkey.
- **Daily Briefing card** on `/dashboard`. Calls `prepare_context("today")`. Depends on Phase 4 merged.

**Aeon board card for this work:** *Hyperspace Notes + Aeon memory widgets* in the **Up Next** column on the AEON APP board, with full grouped checklist (10 items across Hotkey / Destination / Widgets).

---

## 5. Implementation slicing

Three milestones — ship each independently, get feedback, layer on.

### MVP — ~2 days (the "useful immediately" version)
- `/brain` route exists, renders
- **2D** force-directed graph via `react-force-graph-2d` (NOT 3D yet — validates UX before committing to WebGL)
- Quick Capture hotkey + overlay (shared component)
- 3 capture buttons (Note, EOD, Pin)
- Pinned + recent sidebar
- No bloom, no voice, no live-update animation yet

### Stunning — +3-5 days (the visual upgrade)
- Replace `react-force-graph-2d` with `r3f-forcegraph` 3D
- Inherit Swarm planet shader patterns (additive halo, toneMapped false)
- SelectiveBloom postprocess
- Realm tinting via halo colour
- Recency glow via emissive multiplier
- Live-capture animation (Pusher → graph append + edge ripple)
- Click-to-fly camera

### JARVIS — +2-3 days (the moment)
- Web Speech API mic with live transcript
- Voice → `prepare_context` → SelectiveBloom on hit nodes + edge pulse
- Daily Briefing card on dashboard + `/brain` sidebar
- TTS read-back of briefing

**Total to full vision: ~1.5 weeks of focused build.** MVP is shippable in 2 days.

---

## 6. File map — exactly what to touch

### To create
```
apps/web/src/app/brain/page.tsx                       # /brain route entry
apps/web/src/app/brain/layout.tsx                     # full-bleed dark layout
apps/web/src/components/brain/Cortex.tsx              # the 3D scene (R3F)
apps/web/src/components/brain/CortexNode.tsx          # single-node R3F primitive
apps/web/src/components/brain/CortexEdge.tsx          # edge primitive w/ type colour
apps/web/src/components/brain/CaptureRail.tsx         # left rail
apps/web/src/components/brain/TrackingRail.tsx        # right rail
apps/web/src/components/brain/MemorySidePanel.tsx     # slide-in detail panel
apps/web/src/components/brain/useBrainData.ts         # hook: fetch memories + edges, subscribe Pusher
apps/web/src/components/brain/useCortexCamera.ts      # hook: fly-to + idle-orbit logic

apps/web/src/components/hyperspace/QuickCaptureOverlay.tsx   # shared by /brain + global hotkey
apps/web/src/components/hyperspace/CaptureFab.tsx     # floating FAB for app shell
apps/web/src/components/hyperspace/EodReflectionCard.tsx     # dashboard widget

apps/web/src/app/notes/page.tsx                       # /notes bento destination
apps/web/src/components/notes/BentoGrid.tsx
apps/web/src/components/notes/NoteCard.tsx
apps/web/src/components/notes/PromoteToCardModal.tsx
```

### To modify
```
apps/web/src/app/layout.tsx                # mount QuickCaptureOverlay globally + capture FAB
apps/web/src/components/sidebar/...        # add /brain + /notes nav entries
apps/web/src/app/dashboard/page.tsx        # mount EodReflectionCard + DailyBriefingCard
apps/web/src/lib/data/memories.ts          # add `listAllMemoryEdges(userId)` helper for the graph render
apps/web/src/app/api/v1/memories/route.ts  # add ?graph=true mode that returns nodes+edges in one call
```

### Dependencies to add
```
npm i r3f-forcegraph three-forcegraph
npm i @react-three/postprocessing       # if not already present from swarm
# @react-three/fiber + three are presumably already in the workspace
```

Check `apps/web/package.json` first — Aeon may not yet have `@react-three/fiber` even though Swarm does. If not, this is the larger dep add.

---

## 7. Backend extensions needed

Minimal — almost everything is already there.

1. **`GET /api/v1/memories?graph=true`** — single call that returns `{ nodes: Memory[], edges: { source, target, type }[] }` for the entire user. Optional `realmId` to scope. Add to `apps/web/src/app/api/v1/memories/route.ts`. Avoids N+1 on the Cortex first paint.
2. **`getAllMemoryEdges(userId, realmId?)`** in `lib/data/memories.ts` — flatten the `links` jsonb across all user-owned memories.
3. **Pusher broadcast** on `create_memory` / `update_memory` / `delete_memory` to `user-${userId}` channel. The stub already exists in `lib/actions/memories.ts:171-174` (`broadcastMemoryEvent`) — fill it in for Phase 5.

That's all. No schema migration, no new auth surface.

---

## 8. Open questions for the next session

1. **Naming.** `/brain` (matches docs) or do we want a flagship name (`/cortex`, `/synapse`, `/mind`)? *Author's lean: `/brain` for URL, "Cortex" for the visualization, "Hyperspace" for the capture surface — three nouns, three roles.*
2. **MVP first vs commit to 3D from the start.** *Lean: MVP first (2D), upgrade to 3D once UX validated.*
3. **Realm anchoring of session-captured memories.** Currently lands as `realmId=null` unless `BRAIN_DEFAULT_REALM_ID` env is set. Should we auto-detect from `.aeonrc` per repo? (Phase 2.5 wishlist in `05-session-capture.md`.)
4. **Voice provider for STT.** Web Speech API (free, browser) vs Whisper-on-server (better accuracy, costs money). *Lean: ship Web Speech first; add Whisper opt-in later if accuracy is the bottleneck.*
5. **Mobile/PWA story.** 3D Cortex on a phone? Or 2D fallback for narrow viewports? *Lean: 2D below 768px, 3D above.*
6. **`/eod` slash-command skill.** Build it in this batch (lives at `~/.claude/skills/eod/SKILL.md`) or defer until the EOD widget is up?

---

## 9. SOTA references (May 2026)

### 3D knowledge-graph libs
- [`r3f-forcegraph`](https://github.com/vasturiano/r3f-forcegraph) — R3F wrapper, our pick
- [`three-forcegraph`](https://github.com/vasturiano/three-forcegraph) — underlying lib
- [`react-force-graph` showcase](https://vasturiano.github.io/react-force-graph/) — 2D/3D/VR/AR variants
- [`cosmos.gl`](https://github.com/cosmosgl/graph) (OpenJS) — GPU-shader force layout for >50k nodes (future scale fallback)

### Bloom / post-processing
- [`@react-three/postprocessing`](https://react-postprocessing.docs.pmnd.rs/effects/bloom) — `<Bloom>` + `<SelectiveBloom>`
- [Wael Yasmina: Unreal Bloom Selective](https://waelyasmina.net/articles/unreal-bloom-selective-threejs-post-processing/) — single-object bloom pattern (great for "this node is the hit")

### Personal-memory / second-brain UI references (2026)
- [Mem.ai](https://mem.ai) — AI-first auto-surfacing, summaries, ambient retrieval
- [Tana](https://tana.inc) — supertags (node-based + structured), graph view
- [Reflect.app](https://reflect.app) — opinionated daily-notes, minimalist
- [Capacities](https://capacities.io) — object-based PKM
- [Heptabase](https://heptabase.com) — visual-whiteboard PKM, spatial reasoning
- [Mem.ai blog: state of AI agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — benchmarks
- [Best Second Brain Apps 2026 (Buildin)](https://buildin.ai/blog/best-second-brain-apps-2026) — comparative landscape

### Voice-first / ambient UX
- [12 UI/UX Design Trends for AI Apps 2026](https://www.groovyweb.co/blog/ui-ux-design-trends-ai-apps-2026)
- [Voice UI Design Guide 2026 (Fuselab)](https://fuselabcreative.com/voice-user-interface-design-guide-2026/)
- [How OpenAI's 2026 device signals UX trends (Fruto)](https://fruto.design/blog/openai-ai-device-ux-trends-2026)
- [JARVIS Arc Reactor reference (GitHub)](https://github.com/cam-hm/jarvis) — voice-activated assistant with R3F holographic UI; useful as a *visual* reference for the mic-pulse + brain-react pattern

### Persistence-layer competitors to read carefully
- [`agentmemory`](https://github.com/rohitg00/agentmemory) — 95.2% R@5 on LongMemEval, MCP-compatible across 30+ clients. Their `SessionStart` backfill is the closest precedent to ours.
- [`claude-memory-compiler`](https://github.com/coleam00/claude-memory-compiler) — Karpathy-inspired knowledge-article extraction from session transcripts
- [`claude-mem`](https://github.com/thedotmack/claude-mem) — 74.8K stars, 5-hook lifecycle, SQLite + FTS5

**Strategic framing reminder:** the SessionStart hook + backfill + capture script is now commodity work in 2026. Aeon's actual differentiation is *brain fused into a project-management product with MCP+REST parity and a polished UI*. The Cortex screen is the visible piece of that thesis — do not skimp on it.

---

## 10. Boot sequence for the next session

```bash
# 1. Pull the latest, on this branch
cd C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon
git checkout feature/hyperspace_notes
git pull

# 2. Open the Phase 4 PR if not already merged
gh pr create --base main --head feature/brain_phase4 --title "..."
# review, merge, then:
git checkout feature/hyperspace_notes
git merge main           # pulls in prepare_context

# 3. Confirm Phase 2 capture is filling the brain
node apps/web/scripts/claude-session-capture.mjs --backfill --hours 24

# 4. Add R3F + force-graph deps
cd apps/web
npm i @react-three/fiber @react-three/drei @react-three/postprocessing three r3f-forcegraph

# 5. Start by building Quick Capture (shared component) → MVP /brain (2D) → upgrade to 3D
npm run dev
```

**Read this doc + `04-phase-roadmap.md` + `02-mcp-tools.md` before touching code.** Everything you need is there.

---

*— end of handoff —*
