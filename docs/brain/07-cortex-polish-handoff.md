# Track A — Cortex visual polish: port + morph from Swarm

**Status:** spec drafted 2026-05-21. Implementation NOT started.
**Branch to work on:** `feature/cortex-swarm-port` (cut from `feature/hyperspace_notes`).
**Time estimate:** 1 focused session.
**Philosophy reminder from the user:** *"My ultimate edge is taking something amazing and making it better."* This track is **copy + morph**, not invent. Every visual element here exists in `shadow_app_swarm` already, polished and tuned. The job is to lift it into Aeon's brain visualisation.

---

## 1. Current state — why this track exists

The Cortex (`/brain` route in Aeon) currently renders a 3D force-directed memory graph using `r3f-forcegraph`. The framework choice is correct. The **visual quality is wrong** because the previous implementation (which is YOU if you've just been spawned here, or me) tried to invent the look instead of porting Swarm's proven recipe.

Specific things wrong with current `apps/web/src/components/brain/Cortex3D.tsx`:

1. **"Shit circles" around nodes** — there are two transparent additive shells (`halo` at 1.65× node radius, `corona` at 3.2×). When rendered low-poly with additive blending, they show up as flat overlapping rings — NOT as atmospheric glow. **Delete these.**
2. **Stars are stock drei `<Stars>`** — uniform billboard sprites. Swarm replaced this with a 5-layer point-shader system (22k stars across multiple depth shells with bimodal magnitudes, proper spectral colours, diffraction spikes). Use that instead.
3. **Nebulae are low-poly additive spheres** — they look like flat coloured discs from any angle. Swarm uses canvas-generated star-field textures on flat billboards + a separate volumetric raymarched nebula shader for the depth.
4. **Spheres look flat** — they're `MeshStandardMaterial` with emissive colour and no surface detail. Swarm has a per-archetype custom shader pipeline (gas giant / terrestrial / icy) with FBM noise, day/night terminator, atmosphere shell with proper limb glow.

---

## 2. Files to copy + morph from Swarm

Everything lives under:

```
C:/Users/anselikhov/data_science/dev_26/shadow_app_swarm/apps/web/src/components/hud/background/warp/
```

**Lift these files** (read them in full, port to Aeon, morph as noted):

| Swarm file | What it does | Aeon morph |
|---|---|---|
| `Planet.tsx` | Per-archetype GLSL shaders (gas-giant / terrestrial / icy) + atmosphere shell with Rayleigh+Mie+terminator + instanced ring system | Each memory node becomes a `<Planet>`. Position driven by `r3f-forcegraph` (not static). Archetype picked by hash of `realmId`/`repo`. Hue picked by `nodeHue(node, colorMode)`. |
| `CinematicStarfield.tsx` | 5 layered point-cloud star fields, ~22k stars, bimodal magnitudes, spectral colour, twinkle shader, diffraction spikes | Drop the relativistic + audio-modulation uniforms — Aeon doesn't have those. Keep all layers + brightness boosts. Mount in Cortex Canvas at scene root. |
| `NebulaSprite.tsx` | Canvas-generated radial-gradient + dotted texture, breathing scale animation, additive plane geometry | Use as-is. Mount 4-6 instances at varied positions. |
| `RaymarchedNebula.tsx` | 16-step volumetric raymarched nebula (3D FBM noise, ray-sphere intersect, Henyey-Greenstein phase) | Mount 1-2 instances at deep z (background). One per "realm cluster" eventually. Expensive — keep STEPS at 16. |
| `PostFX.tsx` | Bloom + ChromaticAberration + Vignette + RadialBlur + (optional GodRays / SSAO) | Drop audio-modulation. Drop speed-based remount. Keep all four effects with static params: bloom intensity ~1.4, threshold 0.18; chromatic offset 0.0008/0.0006; vignette offset 0.22, darkness 0.78; radial blur strength 0.04. |
| `params.ts` (look it up) | Contains `SUN_DIR`, `POST` per-speed configs | Copy `SUN_DIR` constant. The rest doesn't apply (Aeon has no speed states). |

**Skip these from Swarm** — not applicable:
- `HyperspaceStreaks.tsx` (Aeon doesn't have warp speed)
- `CockpitHUD.tsx` (different UX framing)
- `Letterbox.tsx` (no cinematic letterbox in Aeon)
- `AsteroidSwarm.tsx` (unless we want decorative motion; defer)
- `CameraRig.tsx` (Aeon uses `<OrbitControls autoRotate>` instead)
- `Sun.tsx` (no central sun in Cortex — the "centre" is conceptual)
- `events/*` (DistantBattle, Comet, UFO, etc — Phase 3+)
- `ReactorOrbPlanets.tsx` — **the previous me misread this**. These are emissive landmark orbs for Swarm's cockpit vista, NOT the same as the textured planets. Cortex nodes should use `Planet.tsx` (textured archetypes), NOT `ReactorOrb` (glowing balls). Glowing-ball mode is a fallback for memories with no archetype mapping.

---

## 3. The morph — exact adaptations

### 3.1 `Planet.tsx` → `Cortex3D` node rendering

**Problem:** Swarm's `Planet` is rendered as a static `<Planet>` JSX element. Aeon's nodes are dynamic — their positions are mutated each frame by `r3f-forcegraph` via the `nodeThreeObject` imperative callback. The Planet component uses hooks (`useRef`, `useMemo`, `useFrame`) which can't be called inside an imperative builder.

**Two solutions — pick (a):**

**(a) Render planets in JSX, sync positions via `useFrame`** (recommended)
- Don't use `r3f-forcegraph`'s `nodeThreeObject` at all. Use it only for the force simulation positions (transparent or tiny placeholder mesh).
- Render `<Planet>` instances in JSX, one per `SceneNode`.
- In `useFrame`, walk the simulation's node array and `position.copy(...)` each Planet's group ref to the simulated position.
- Pro: full React lifecycle on Planet (custom shaders, atmosphere mesh, instanced rings work naturally). Con: two passes per frame.

**(b) Keep imperative `nodeThreeObject`, port shaders manually**
- Inside `nodeThreeObject`, manually construct `THREE.ShaderMaterial` with the surface shaders + atmosphere shell + ring instanced mesh.
- All hooks-less, builds vanilla three.js objects.
- Pro: single pass. Con: have to manually re-port the shader instantiation logic; can't reuse `<Planet>` as a component.

**Go with (a). The current code uses imperative; the morph is to switch to JSX-rendered planets and let r3f-forcegraph drive positions only.**

### 3.2 Archetype picker

Swarm picks archetype from `config.archetype: 'gas-giant' | 'terrestrial' | 'icy'`. For Aeon:

```ts
function archetypeForNode(node: GraphNode): 'gas-giant' | 'terrestrial' | 'icy' {
  // Hash the realmId (or repo if no realm) to pick a stable archetype.
  // Apps tend to be "active" worlds — terrestrial. Labs tend to be
  // "experimental" — gas giants. Personal/unanchored — icy.
  if (!node.realmId && !node.repo) return 'icy'
  const seed = node.realmId ?? node.repo ?? ''
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const archetypes: Array<'gas-giant' | 'terrestrial' | 'icy'> = ['gas-giant', 'terrestrial', 'icy']
  return archetypes[h % 3]
}
```

Swarm also takes `surfaceHue` (0..1), `atmosphereHue` (0..1), `paletteShift` (0..1) per planet — these drive the per-planet colour variation inside the archetype shader. For Aeon, derive these from `nodeHue(node, colorMode) / 360`:

```ts
const hue = nodeHue(node, colorMode)
const surfaceHue = (hue / 360)
const atmosphereHue = ((hue + 30) % 360) / 360
const paletteShift = (hue / 360)
```

This way, the **same node** stays the **same archetype** AND gets the colour scheme that matches the current `colorMode` toggle (realm / repo / type / source).

### 3.3 Pinned nodes get rings

`PlanetaryRing` from `Planet.tsx` is 600 instanced icosahedron particles in a flat annulus. Use as-is for `node.pinned === true`. The radius coefficient (1.35 inner, 2.1 outer) is good. Drop the rotation animation if it costs too much.

### 3.4 Atmosphere shell — non-negotiable

The atmosphere mesh at 1.12× core radius with the `ATMO_FRAG` shader IS what makes Swarm's planets read as actual spheres with depth. The shader handles:
- **Rayleigh scattering** (blue limb)
- **Mie scattering** (warm forward-scatter near the sun direction)
- **Terminator glow** (warm orange rim at day/night boundary)
- **Night limb** (subtle blue hint on the dark side)

**Do not skip this.** This replaces the deleted `halo` and `corona` shells. One physically-motivated shader > two flat additive shells.

### 3.5 Stars — port `CinematicStarfield.tsx` verbatim, strip relativistic + treble

Swarm's stack:
```ts
const LAYERS = [
  { count: 2800, radius: 50,  depthRange: 25,  base: -15,  brightnessBoost: 0.55 },
  { count: 3600, radius: 75,  depthRange: 50,  base: -45,  brightnessBoost: 0.65 },
  { count: 4400, radius: 110, depthRange: 80,  base: -100, brightnessBoost: 0.75 },
  { count: 5200, radius: 160, depthRange: 110, base: -180, brightnessBoost: 0.85 },
  { count: 6000, radius: 220, depthRange: 140, base: -280, brightnessBoost: 0.95 },
]
```

The Aeon Cortex is wider-camera (camera at z=380 vs Swarm's z=15-ish). **Scale all radius / base / depthRange values by ~5×** so the layers actually surround the scene. Test and tune.

Drop these uniforms from the shader (and the buildGeometry caller):
- `uRelativistic` — no warp speed
- `uTrebleMod` — no audio
- `uOffset` — no streaming motion

Keep:
- `uTime` (for twinkle)
- `uPixelRatio`
- The bimodal hero-star pass
- The spectral colour classification
- The diffraction spike for hero stars

### 3.6 Nebulae — port `NebulaSprite.tsx` + add `RaymarchedNebula.tsx`

**NebulaSprite** is a flat plane with a canvas-generated texture. Mount 4-6 instances at varied positions and scales:

```tsx
<NebulaSprite position={[ 280,  120, -250]} color="#7c3aed" scale={520} driftSeed={0.12} getOpacity={() => 0.55} />
<NebulaSprite position={[-300,  -60, -300]} color="#0ea5e9" scale={580} driftSeed={0.43} getOpacity={() => 0.5}  />
<NebulaSprite position={[  60,  340, -180]} color="#ec4899" scale={420} driftSeed={0.71} getOpacity={() => 0.45} />
<NebulaSprite position={[   0,    0, -460]} color="#f59e0b" scale={700} driftSeed={0.91} getOpacity={() => 0.35} />
<NebulaSprite position={[-180, -280, -220]} color="#a855f7" scale={380} driftSeed={0.27} getOpacity={() => 0.4}  />
```

(Strip the `getOpacity` ref pattern if you don't need audio modulation — pass plain opacity.)

**RaymarchedNebula** is the volumetric one. Add 1-2 instances:

```tsx
<RaymarchedNebula center={[200, 100, -350]} radius={180} color="#a855f7" opacity={0.6} driftSeed={0.4} />
<RaymarchedNebula center={[-220, -80, -400]} radius={220} color="#22d3ee" opacity={0.5} driftSeed={0.7} />
```

This shader is GPU-heavy (16 raymarch steps × every pixel covered by the bounding sphere). Two is the limit. If frame rate tanks, drop to one.

### 3.7 PostFX — port `PostFX.tsx`, strip audio/speed modulation

Swarm reads `POST[speed]` to pick params per warp tier. Aeon has one tier. Use these static values:

```tsx
<EffectComposer multisampling={0}>
  <Bloom intensity={1.4} luminanceThreshold={0.18} luminanceSmoothing={0.25} radius={0.88} mipmapBlur />
  <ChromaticAberration offset={new Vector2(0.0008, 0.0006)} radialModulation={false} modulationOffset={0} />
  <Vignette eskil={false} offset={0.22} darkness={0.78} />
  <RadialBlur strength={0.04} />
</EffectComposer>
```

(Keep the `RadialBlur` component port from Swarm — it's a custom effect.)

**Drop:**
- `SSAO` — overkill for this scene
- `GodRays` — needs a sun mesh, Cortex doesn't have one

### 3.8 Lighting

Swarm uses a `SUN_DIR` constant (vec3 normalized) consumed by the shaders directly. For Aeon, define a single sun direction in `params.ts`:

```ts
export const SUN_DIR = new THREE.Vector3(0.4, 0.6, 0.8).normalize()
```

This goes into all custom shaders (`uSunDir`). Mount a single `<directionalLight position={...} intensity={1.2}>` aimed in the same direction for any non-custom-shader materials (the ring particles use MeshStandardMaterial).

Drop my current three point-light setup once the directional + atmosphere shaders are in.

---

## 4. Aeon files this track will touch

### Delete (these are the legacy implementations)
```
apps/web/src/components/brain/Cortex3D.tsx                  # full rewrite
```

### Create
```
apps/web/src/components/brain/cortex/params.ts              # SUN_DIR, archetype enum, hue mapping
apps/web/src/components/brain/cortex/Planet.tsx             # ported + morphed from swarm/Planet.tsx
apps/web/src/components/brain/cortex/CinematicStarfield.tsx # ported, relativistic/audio stripped
apps/web/src/components/brain/cortex/NebulaSprite.tsx       # ported
apps/web/src/components/brain/cortex/RaymarchedNebula.tsx   # ported
apps/web/src/components/brain/cortex/PostFX.tsx             # ported, simplified
apps/web/src/components/brain/cortex/RadialBlur.tsx         # ported as-is
apps/web/src/components/brain/cortex/PlanetCloud.tsx        # NEW — renders one <Planet> per SceneNode, syncs positions from force-graph
apps/web/src/components/brain/Cortex3D.tsx                  # NEW shell — composes all of the above
```

### Keep
```
apps/web/src/components/brain/CaptureRail.tsx               # unchanged
apps/web/src/components/brain/TrackingRail.tsx              # unchanged
apps/web/src/components/brain/CortexLegend.tsx              # unchanged
apps/web/src/components/brain/MemorySidePanel.tsx           # unchanged
apps/web/src/components/brain/useBrainData.ts               # unchanged
apps/web/src/components/brain/nodeColor.ts                  # unchanged
apps/web/src/components/brain/cortexAssets.ts               # unchanged — kept for spaceship + skybox if user generates them later
apps/web/src/components/brain/useCortexTextures.ts          # unchanged — same reason
apps/web/src/app/brain/page.tsx                             # unchanged
```

The asset-loading scaffolding I built (`cortexAssets.ts` + `useCortexTextures.ts`) is still useful for the spaceship sprite and the optional HDRI skybox. Once the Swarm-ported scene works, the user can decide whether they still want the AI-generated planet PNGs at all — the custom shaders may obsolete them.

---

## 5. Architectural decisions to lock

1. **Render planets via JSX, not via `nodeThreeObject` callback.** Pass `r3f-forcegraph` an empty / invisible node mesh; render one `<Planet>` per scene node in JSX next to the graph component; sync positions with a single `useFrame` walk. This is the only way to use Swarm's shader-laden Planet component which depends on React hooks.
2. **Edges stay via r3f-forcegraph.** They're the only thing the force-graph genuinely owns. Particles + colours + opacity already configured.
3. **`OrbitControls autoRotate` stays.** Aeon needs a slow idle camera. Don't port Swarm's CameraRig.
4. **No audio reactivity in Aeon.** Strip every `audioRef`, `getTreble`, `getBass`, `getOverall` callback when porting.
5. **Hover/select labels via drei `<Html>`** — already working in current Cortex3D. Keep that pattern; lift it into `PlanetCloud.tsx`.
6. **Asset-PNG path remains optional.** If user drops `cortex/skybox.png` etc., still use them. If not, the custom shader scene stands on its own.

---

## 6. Acceptance criteria

A successful port:

- [ ] Cortex shows ~22k stars across 5 layers with visible twinkle and occasional diffraction spikes
- [ ] No flat overlapping translucent circles around any node — atmosphere reads as a soft limb glow, not a ring
- [ ] Each node is a textured-looking sphere (gas band swirls / continent patterns / icy cracks visible on close zoom)
- [ ] Pinned nodes have proper instanced-particle rings, not a single ring mesh
- [ ] Background has at least 4 sprite-nebulae + 1 raymarched volume with visible depth
- [ ] Post-FX chain: bloom + chromatic + vignette + radial blur active
- [ ] WebGL context survives at least 5 minutes of auto-rotate without dying
- [ ] All 17 existing memories visible as planets, clustered, with edges
- [ ] Color toggle (realm/repo/type/source) still affects planet palette via `paletteShift` uniform

---

## 7. Visual reference

- Target aesthetic: `C:/Users/anselikhov/OneDrive - SEFE Securing Energy for Europe GmbH/Desktop/imges/aeon/cortex_concept.png` (user's AI-generated concept)
- Source aesthetic (to match/exceed): `C:/Users/anselikhov/OneDrive - SEFE Securing Energy for Europe GmbH/Desktop/imges/aeon/neurons.png`
- Current state to improve upon: `cortex_v3.png` in the same folder
- **The point of reference for HOW: actual code in `shadow_app_swarm`.** That's where the SOTA recipe lives. Use it.

---

## 8. Out of scope for this track

- Asset PNGs (skybox, planet maps, nebula brushes, spaceship) — already scaffolded, lights up if files appear
- Volumetric edge beams / shader edges — Phase 3+
- Selective bloom on selected node — defer (WebGPU TSL would make this easy; current effect-composer pipeline makes it hacky)
- New camera modes / cinematic transitions — defer
- "Spaceship navigating between nodes" — handled by existing `useCortexTextures` spaceship sprite if asset arrives
- Performance optimisation for >500 nodes — current scale is 17, ceiling for r3f-forcegraph is ~5k. Defer.

---

## 9. Boot sequence for the next agent

```bash
cd C:/Users/anselikhov/data_science/dev_26/shadow_app_aeon
git checkout feature/hyperspace_notes
git checkout -b feature/cortex-swarm-port

# Read these in order, no skipping:
cat docs/brain/07-cortex-polish-handoff.md   # this file
cat CLAUDE.md                                 # project rules
# Then study the Swarm source:
ls C:/Users/anselikhov/data_science/dev_26/shadow_app_swarm/apps/web/src/components/hud/background/warp/
# Open and read FULLY:
#   Planet.tsx
#   CinematicStarfield.tsx
#   NebulaSprite.tsx
#   RaymarchedNebula.tsx
#   PostFX.tsx
#   RadialBlur.tsx
#   params.ts
# Then begin the port — JSX-driven planets, force-graph drives positions.

npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
# Both must stay green throughout.
```

When done: commit, push, open PR against `feature/hyperspace_notes`. Reference this doc.
