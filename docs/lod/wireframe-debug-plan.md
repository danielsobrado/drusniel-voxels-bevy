# Terrain Wireframe & Mesh Debug View — Plan

> Created: 2026-05-23 · Status: Planning
> Scope: `src/voxel/meshing.rs`, `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
> `src/rendering/triplanar_material.rs`, `src/runtime_commands.rs`,
> `src/interaction/debug.rs`, `assets/shaders/triplanar_terrain.wgsl`,
> `docs/lod/`
> Owner: terrain/rendering
>
> Decision context: per peer advice ("check it in wireframe first; if the
> geometry is stepped, it's the DC/QEF placement; if the geometry is smooth
> but shading is stepped, it's normals"), we need a runtime wireframe
> diagnostic that can answer **geometry vs shading** in seconds, plus a few
> small additions that let us tell **which mesh section** (main / skirt /
> transition apron) and **which LOD** a visible artifact belongs to. Without
> this, every seam investigation is guesswork.

## Why this, why now

The MC+Transvoxel spike (see [`mc-transvoxel-plan.md`](mc-transvoxel-plan.md))
costs 3 weeks. Before committing that, the diagnostic costs **1–2 days** and
directly answers the question that determines whether MC+Transvoxel is the
right next step:

- If the visible "terraced" artifacts are **geometric** — the mesh truly has
  stepped polygons — the spike is justified: DC/QEF/extractor choice is the
  issue.
- If the artifacts are **smooth geometry under stepped shading** — the mesh
  is fine and normals are quantized — MC+Transvoxel does not help; the fix
  is normal computation (cheap), not a new mesher.

The current `WireframeDebug` material variant gets the **geometry vs shading**
question answered today *if* the rest of the diagnostic UX is finished. This
plan finishes it.

## What already exists in the tree (verified)

| Piece | State | Evidence |
|---|---|---|
| `WireframeDebug` material variant | Defined | `TerrainMaterialQuality::WireframeDebug` referenced in [`runtime_commands.rs:5551`](../../src/runtime_commands.rs#L5551), `bench/mod.rs:265`, plugin handle in `plugin.rs:2879` |
| Barycentric UVs on main SN mesh | Emitted | `MeshData.barycentric_uvs` populated via `push_triangle_barycentrics` ([`meshing.rs:325`](../../src/voxel/meshing.rs#L325)) for all four SN LODs |
| Barycentric UVs on skirts | Emitted | `push_quad_barycentrics` in [`skirt.rs:351`](../../src/voxel/skirt.rs#L351) |
| Wireframe shader branch | In WGSL | `#ifdef TERRAIN_DEBUG_WIREFRAME` in [`triplanar_terrain.wgsl:455-460`](../../assets/shaders/triplanar_terrain.wgsl#L455) |
| Bench TOML activation | Works | `bench/mod.rs:265-285` maps `BenchTerrainMaterialQuality::WireframeDebug` |

## What does NOT exist (gaps this plan fills)

| Gap | Impact |
|---|---|
| Runtime hotkey to toggle wireframe globally | Today wireframe is reachable only through a bench TOML; switching in a live scene requires editing config and relaunching |
| Distinguish skirt vs main mesh vs (future) transition apron in wireframe | Today both use the same barycentric pattern → wireframe renders identical edges → can't tell whether a visible edge belongs to a skirt or the real surface |
| LOD coloring | Today the wireframe is monochrome white; you can't see which chunk is LOD0 vs LOD1 vs LOD2 at a glance |
| Separate normal-vis mode | Today edges are overlaid on the lit color, mixing geometric and shading signal. We need a clean "normals as colour" mode that answers the shading question in isolation |
| Capture helper for A/B screenshots | Today you take screenshots ad-hoc; we want a one-key capture that writes to `debug/wireframe-<timestamp>.png` with the camera matrix + active mode in a JSON sidecar so we can correlate frames against hole-probe dumps |
| Interpretation guide | Without one, the diagnostic helps people who already know what to look for; a small recipe doc closes that gap |

## Success criteria

The plan is complete when an engineer can, in a single live session, **without
editing config or rebuilding**, do the following with one key per step:

1. Toggle wireframe overlay on/off.
2. Toggle normal-visualisation mode on/off (independent of wireframe).
3. See LOD coloring in the wireframe (per chunk's current LOD).
4. See main mesh vs skirt vs (future) transition apron in different wire
   colours.
5. Capture a frame + a JSON sidecar with camera state + active mode flags.
6. Read [`docs/lod/wireframe-debug-guide.md`](wireframe-debug-guide.md) and
   classify a visible artifact as **geometry / shading / skirt / section
   mismatch** in under a minute.

---

# Epic: WIRE — Terrain Wireframe & Mesh Debug View

## Phase 0 — Minimum viable diagnostic (must-have)

### WIRE-001 — Audit current wireframe end-to-end

**Type:** Investigation · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** Confirm exactly what the existing `WireframeDebug` quality produces
today, so the rest of the plan doesn't redo work that's done.

**Tasks.**
- Launch with `bench/scenes/visual/visual-regression-seam-mountain.toml`
  configured for `terrain_material_quality = WireframeDebug`. Capture a
  screenshot.
- Read [`triplanar_terrain.wgsl:455-460`](../../assets/shaders/triplanar_terrain.wgsl#L455)
  and verify the WGSL `TERRAIN_DEBUG_WIREFRAME` define lights up under that
  bench quality.
- Verify [`runtime_commands.rs:5546-5556`](../../src/runtime_commands.rs#L5546-L5556)
  routes the wireframe material handle correctly. The match-then-clone
  pattern there is suspicious (the `WireframeDebug` arm falls back to the
  `full` handle) — confirm whether the chunk actually gets the wireframe
  shader or just an aliased `FullTriplanar` shader at runtime.

**Acceptance.**
- A screenshot proves `TERRAIN_DEBUG_WIREFRAME` IS active under
  `WireframeDebug` quality (visible white edges on triangles).
- If the screenshot shows lit terrain with NO edges, the material-handle
  routing in `runtime_commands.rs` is wrong — surfaced as a one-paragraph
  finding in WIRE-002's ticket.

---

### WIRE-002 — Runtime hotkey to toggle wireframe globally

**Type:** Engineering · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** A live, no-rebuild way to flip every visible terrain chunk into
`WireframeDebug` and back.

**Tasks.**
- Add a debug input handler (likely in [`src/interaction/debug.rs`](../../src/interaction/debug.rs)
  next to existing debug bindings, or a new `terrain_debug` submodule) that
  on `F7` (suggested; bind via the existing input-mapping system if there is
  one — verify) flips a resource `TerrainDebugView { wireframe: bool, ... }`.
- A system in [`src/voxel/plugin.rs`](../../src/voxel/plugin.rs), running
  when the resource changes, walks all `ChunkMesh` entities and reassigns
  their material handle to the wireframe handle (when on) or back to their
  natural per-quality handle (when off). Avoid mutating
  `chunk_mesh.material_quality` itself — overlay via handle reassignment so
  the natural quality is preserved for restore.
- On-screen one-line indicator while wireframe is active (egui or
  existing debug overlay) so it's not silently left on.

**Acceptance.**
- Press `F7` in a live scene → terrain switches to wireframe within one
  frame, with an on-screen "WIRE ON" hint.
- Press `F7` again → terrain returns to the prior quality on every chunk,
  hint disappears.
- Toggling while flying around does not crash, does not leak handles, does
  not affect non-terrain entities (water, props, vegetation).

**Notes.** If WIRE-001 reveals the handle routing is broken, fix that in the
same ticket — the audit's finding becomes a one-line fix here.

---

### WIRE-003 — Mesh-section colouring (main / skirt / future apron)

**Type:** Engineering · **Priority:** P0 · **Estimate:** 0.5–1 day

**Goal.** Distinguish triangles by which mesh-generation path produced them.

**Tasks.**
- Reserve **`uv_b.x`'s sign bit** (or use a new vertex attribute slot if
  free) to tag the section:
  - `0` = main SN mesh (default).
  - `1` = horizontal skirt.
  - `2` = vertical skirt (the one that currently emits zero indices per
    hole-probe — useful to see *if* it's there, not just *whether* it's
    counted).
  - `3` = (reserved) transvoxel transition apron, for future MC+Transvoxel
    integration.
- Patch the four SN LOD generators in [`meshing.rs`](../../src/voxel/meshing.rs)
  and `push_quad_barycentrics` / skirt callers in
  [`skirt.rs`](../../src/voxel/skirt.rs) so the right tag is written at
  emission time.
- Shader: when `TERRAIN_DEBUG_WIREFRAME` is set, multiplex edge colour by
  section tag — e.g. **white** for main, **cyan** for horizontal skirt,
  **magenta** for vertical skirt, **yellow** for apron.

**Acceptance.**
- Wireframe screenshot of a chunk shows distinctly-coloured edges where
  skirt geometry is present (the LOD ring scene from
  `visual-regression-seam-mountain.toml` is the test case).
- A unit / fingerprint test that meshes a small chunk asserts the section
  tag values present in `MeshData` match the geometry that was emitted.
- No regression to non-wireframe materials (the tag is ignored when
  `TERRAIN_DEBUG_WIREFRAME` is not defined).

**Notes.** Reusing UV1's spare component avoids adding a new vertex attribute
slot and the bind-group / vertex-layout churn that comes with it.

---

### WIRE-004 — LOD colouring on the wireframe

**Type:** Engineering · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** Tell at a glance which LOD a triangle's chunk is.

**Tasks.**
- Per-chunk uniform / push constant carrying the chunk's `LodLevel` as a
  u8: extend the material instance or piggyback on the existing per-chunk
  uniform structure (verify what's already there — most likely
  `TriplanarMaterial`'s instance data).
- In the wireframe shader branch, choose the edge tint as a function of the
  LOD level: e.g. LOD0 = no tint (white), LOD1 = light blue, LOD2 = green,
  LOD3 = orange. Combine with section colour by multiplication so both
  encodings remain readable.

**Acceptance.**
- Mountain scene wireframe with LOD ring visible: LOD0 chunks tinted
  differently from LOD1 chunks; the transition ring is immediately
  obvious in the screenshot.
- Bench TOML and runtime toggle both produce the same colouring.

---

### WIRE-005 — Normal visualisation mode

**Type:** Engineering · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** Answer "is the visible step in the geometry, or in the shading?"
without changing camera position.

**Tasks.**
- Add a second debug mode flag in `TerrainDebugView`:
  `normals: bool`. Bind to `F8`.
- Shader: when the flag is on (new shader define
  `TERRAIN_DEBUG_NORMALS`), output `vec4(world_normal * 0.5 + 0.5, 1.0)`
  as the final colour, bypassing the lit pipeline. Independent of the
  wireframe flag.
- Both flags can be on together (wireframe over normal-vis); the wireframe
  edges then sit on top of the normal-as-colour fill.

**Acceptance.**
- Press `F8`: terrain becomes the standard RGB-encoded-normal look.
- Stepped normals (the "quantised normal" failure mode) appear as flat
  RGB patches with sharp colour discontinuities; a smooth surface with
  continuous normals appears as a smooth colour gradient.
- Combined `F7 + F8`: wires on top of normal-fill, both modes readable.

---

### WIRE-006 — Capture-to-disk helper

**Type:** Engineering · **Priority:** P1 · **Estimate:** 0.5 day

**Goal.** Make A/B comparisons reproducible.

**Tasks.**
- Bind `Shift+F7` to a one-shot screenshot capture:
  - Image: `debug/wireframe-<timestamp>.png` (use whatever framework
    screenshot path Bevy/wgpu supports in this project — check existing
    bench screenshot code in `bench/mod.rs`).
  - Sidecar: `debug/wireframe-<timestamp>.json` with `{camera_pos,
    camera_rot, fov, mode_flags, terrain_settings_hash}`.
- Sidecar lets us correlate a wireframe capture with the hole-probe dump
  from the same camera position via `terrain_settings_hash`.

**Acceptance.**
- A press of `Shift+F7` writes both files.
- The PNG matches what's on screen.
- The JSON contains enough state to relaunch and reproduce the same
  camera + mode.

---

## Phase 1 — Nice-to-haves (deferrable)

### WIRE-007 — SDF iso-band reference overlay

**Type:** Engineering · **Priority:** P2 · **Estimate:** 1–2 days

**Goal.** Compare the rendered mesh surface against the SDF's actual zero
crossing. If the mesh lies below or above the true iso-0 surface, this makes
it obvious.

**Tasks.**
- Add a tiny screen-space pass (or modify the existing terrain pass) that
  samples the world SDF along each fragment's view ray near the mesh and
  highlights pixels where `|sdf| < ε` in a contrasting colour.
- Gate behind a third flag in `TerrainDebugView`, hotkey `F9` (note:
  `Shift+F9` is the hole-probe dump; do not collide).

**Acceptance.**
- A rotating camera around a known surface shows a thin coloured band
  hugging the mesh surface. Where the mesh and SDF disagree, the band
  visibly drifts off the surface.
- Disabled by default; no perf cost when off.

**Notes.** P2 because the height-fan log already quantifies the iso vs mesh
delta numerically; this is the visual equivalent.

---

### WIRE-008 — Interpretation guide

**Type:** Documentation · **Priority:** P0 · **Estimate:** 0.5 day

**Goal.** Write down how to use the diagnostic so it pays off.

**Tasks.**
- Create [`docs/lod/wireframe-debug-guide.md`](wireframe-debug-guide.md)
  with:
  - Key bindings table.
  - A short "what each mode tells you" section.
  - A diagnostic recipe table:

| Visible artifact | Try mode | If you see... | Conclusion |
|---|---|---|---|
| Stair-step bands on slopes | F7 wireframe | Triangles themselves are stepped | Geometry — likely binary SDF / coarse extractor. Look at SDF generation. |
| Stair-step bands on slopes | F8 normals | Triangles are smooth, normal-colour is patchy | Shading — `MeshData.normals` are face-derived not gradient. Switch to SDF-gradient normals. |
| Horizontal seam at altitude band | F7 + LOD colour | Different LOD-tints meet at the seam, edges don't match | LOD boundary mismatch — proceed with MC+Transvoxel plan or SEAM-011 ticket. |
| Horizontal seam at altitude band | F7 + section colour | Coloured (skirt) edges visible at the seam | Skirt is being used to hide the gap and isn't enough — the gap is real. |
| Holes in the surface | F7 | No triangles where there should be some | Missing chunk / failed mesh / wrong dirty flag. Check hole-probe `missing_boundary_neighbors`. |
| Dark patches in flat areas | F8 normals | Normal-colour gradient looks normal | It's lighting / AO, not geometry or normals. Different problem entirely. |

- Reference the per-mode screenshots taken in WIRE-001/002/003/004/005 as
  example outputs.

**Acceptance.**
- A teammate who has never used the diagnostic can read the guide and
  produce a classification for the current `visual-regression-seam-*`
  failures in under 5 minutes.

---

# Backlog summary

| ID | Phase | Title | Priority | Estimate |
|---|---|---|---|---|
| WIRE-001 | 0 | Audit existing wireframe end-to-end | P0 | 0.5d |
| WIRE-002 | 0 | Runtime hotkey to toggle wireframe globally | P0 | 0.5d |
| WIRE-003 | 0 | Mesh-section colouring (main / skirt / apron) | P0 | 0.5–1d |
| WIRE-004 | 0 | LOD colouring on the wireframe | P0 | 0.5d |
| WIRE-005 | 0 | Normal visualisation mode | P0 | 0.5d |
| WIRE-006 | 0 | Capture-to-disk helper + sidecar JSON | P1 | 0.5d |
| WIRE-007 | 1 | SDF iso-band reference overlay | P2 | 1–2d |
| WIRE-008 | 0 | Interpretation guide | P0 | 0.5d |

**Phase 0 total: 3–4 engineer-days.** Phase 1 optional: 1–2 days.

# Definition of Done

The diagnostic is done when, on the current seam scenes, you can press one key
to switch between (a) lit terrain, (b) wireframe with section + LOD colours,
(c) normal-as-colour, capture a frame, and read the guide to classify the
visible artifact — and that classification then **directs** the next code
change: either to the MC+Transvoxel spike (geometry artifact), to a normal-
calculation fix (shading artifact), or to a skirt/snap fix (section artifact).

Without this, every iteration is a guess; with it, the next code change is
informed.

# What this does NOT do

- Does not change any meshing code paths. The current wireframe relies on
  data already in `MeshData`; we are only enriching it (section tag in
  spare UV channel) and lighting it up at the shader.
- Does not affect production performance: all paths gate on the
  `TerrainDebugView` resource being non-default.
- Does not block or substitute for the MC+Transvoxel spike — it only
  improves the evidence we feed into the spike's decision memo (MTX-037).

# Suggested execution order

1. **WIRE-001** (audit, 0.5 d) — confirms what's wired up and what isn't.
2. **WIRE-002** (hotkey, 0.5 d) — the single highest-leverage change. After
   this, every later ticket can be tested live.
3. **WIRE-008** (guide skeleton, 0.5 d) — writing the interpretation table
   while the modes are being built clarifies the design.
4. **WIRE-005** (normals, 0.5 d) — independent, completes the
   geometry-vs-shading question.
5. **WIRE-003** + **WIRE-004** (section + LOD colours, ~1 d combined) —
   complete the wireframe.
6. **WIRE-006** (capture, 0.5 d) — last, so the modes it captures are stable.
7. **WIRE-007** — only if Phase 0 reveals a class of artifact the existing
   modes cannot classify on their own.
