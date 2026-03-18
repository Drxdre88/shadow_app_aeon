# Aeon Brainstorming & Ideation Features — Top 15

Date: 2026-03-11

Complements the existing Board (Kanban) + Gantt infrastructure. Ordered by impact and buildability.

---

## Tier 1 — High Impact, Buildable Now

### 1. Infinite Canvas Brainstorm Board [SELECTED]
Free-form spatial canvas with draggable idea nodes, freehand drawing, arrows/connections. Built on tldraw SDK (React, open source, SDK 4.0). Ideas can be promoted to board tasks with one click. Foundation for layering features #2, #5, #7, #8.

### 2. AI-Powered Idea Expansion
Select any node/card on the canvas, Claude generates related ideas, counter-arguments, or sub-tasks as child nodes. Native to the stack, uses MCP as backbone.

### 3. Force-Directed Knowledge Graph
Physics-based node graph — nodes repel, connected nodes attract. Click clusters to zoom in. Discovers hidden connections between concepts. d3-force or react-force-graph.

### 4. Quick Capture to Triage Flow
Minimal inbox for dumping raw thoughts (text, voice transcription, links, screenshots). Triage view lets you drag into projects, convert to tasks, or discard. Bridges idea to actionable task.

### 5. Radial Mind Map
Central topic radiates outward with animated branches. Glow/glass aesthetic. Color-coded nodes using existing palette. Collapse/expand branches. Export to board tasks.

---

## Tier 2 — Differentiating Features

### 6. Timeline Ideation (Ideas Over Time)
Horizontal timeline pinning ideas/inspirations to dates. See emergence and evolution. Connects to Gantt — ideas graduate into scheduled work.

### 7. Concept Clustering with AI
Paste wall of text (meeting notes, research, braindump), AI extracts key concepts, auto-arranges into themed clusters on canvas. Visual-first approach.

### 8. Mood Board / Visual Collage
Drag in images, color swatches, screenshots, text snippets onto spatial canvas. Pin inspirations alongside tasks. tldraw handles images natively.

### 9. Decision Matrix
Weighted scoring grid: ideas on rows, criteria on columns, scores generate ranked list. Animated bar chart visualization. Simple but rare in PM tools.

### 10. Debate / Pros-Cons Tree
Fork an idea into For/Against branches, expand further. AI plays devil's advocate. Stress-test ideas before committing resources.

---

## Tier 3 — Visionary / Wow Factor

### 11. 3D Idea Space
Three.js powered 3D canvas with floating idea clusters. Navigate by orbiting/zooming. Glowing connections between related nodes.

### 12. Voice-to-Canvas
Speak freely, real-time transcription, AI extracts entities and relationships, nodes appear on canvas as you talk. Zero friction brainstorming.

### 13. Idea Evolution Timeline
Git-like versioning for ideas — see how concepts morphed, branch alternatives, merge best parts. Diff view between iterations.

### 14. Collaborative Swarm Voting
Team members upvote/react to ideas on canvas. Heat map overlay shows consensus. Ideas physically grow/shrink based on vote weight.

### 15. AI Strategy Advisor
Feed entire board state (tasks, dependencies, labels, progress) to Claude, get strategic recommendations: bottleneck identification, unowned clusters, epic splitting. MCP already exposes all data needed.

---

## Architecture Decision

**Foundation:** tldraw SDK (React infinite canvas)
- Mature, open source, SDK 4.0 (2025)
- Handles drawing, shapes, text, images, arrows natively
- Extensible with custom shapes and tools
- Layer Aeon's glass/glow theme on top

**Integration points:**
- Canvas ideas promote to Board tasks via MCP
- Board tasks can be visualized on canvas
- Labels and colors shared across both views
- Dependencies can be drawn as canvas arrows
