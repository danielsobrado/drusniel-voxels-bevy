# Claude Instructions

Keep profiling in the loop as features are added. Rendering work in this repo is performance-sensitive, and unmeasured changes are not enough.

## Performance Expectations

- Use `cargo run --release -- --bench ...` for any change that could affect frame time, render passes, terrain meshing, props, water, shadows, or post effects.
- Prefer the deterministic visual bench scenes so runs are comparable:
  - `bench/scenes/visual/visual-regression.toml`
  - `bench/scenes/visual/visual-regression-high.toml`
  - `bench/scenes/visual/visual-regression-performance100.toml`
  - `bench/scenes/visual/visual-regression-live-lod.toml`
- Compare the generated `bench-runs/<run>/summary.json` before and after the change.
- Do not sum broad timing rows such as Render Graph, Render Prepare, QueueMeshes, or nested prepare brackets. Treat them as separate symptoms.
- Use the fixed screenshot checkpoints from the bench output to check visual stability.

## Regression Guard

Use the bench guard for bottleneck checks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Thresholds live in `assets/config/bench_guard.toml`. Tune thresholds per machine only when needed, and document that choice.

## Reporting

When you claim a perf improvement, include:

1. The bench scene used.
2. The before/after numbers from `summary.json`.
3. The main counters or timing rows that moved.
4. Any visual tradeoff or ready-state issue discovered during the run.

If a change was not benchmarked, say so directly.

## Terrain Debug Views

Live in-game overlays for diagnosing LOD seams, holes, normals, and skirt
geometry. Implementation: [`src/voxel/terrain_debug.rs`](src/voxel/terrain_debug.rs).
Plan + interpretation recipe: [`docs/lod/wireframe-debug-plan.md`](docs/lod/wireframe-debug-plan.md).

| Hotkey | What it does | Output |
|---|---|---|
| **Alt+F7** | Toggle wireframe overlay on terrain. Edges drawn from barycentric UVs, coloured by mesh section × LOD tint. | On-screen indicator: "TERRAIN DEBUG: WIRE ON" |
| **Alt+F8** | Toggle normals-as-colour mode. Replaces lit terrain with `vec3(world_normal * 0.5 + 0.5)`. Combinable with Alt+F7. | On-screen indicator: "TERRAIN DEBUG: NORMALS ON" |
| **Alt+Shift+F7** | Capture current frame. ⚠ Known bug: also fires the Alt+F7 toggle — state flips on every capture. | `debug/wireframe-<ts>.png` + `debug/wireframe-<ts>.json` (camera pose, FOV, mode flags, terrain settings hash) |
| **Shift+F9** | Terrain hole-probe dump (per-chunk LOD, neighbor LODs, snap stats, lod-delta>1 faces, missing-neighbor counts). | `debug/terrain-hole-probe-<ts>.json` |
| **Alt+F5** | Toggle MC+Transvoxel LOD seam spike on/off (Surface Nets terrain only). Remeshes all loaded chunks; F3 `MC+TVX: ON/OFF`. YAML `assets/config/mc_transvoxel.yaml` is startup default only. | Console log + F3 chunk stats line |

### Wireframe colour key

Section colour (multiplied by LOD tint):

| Colour | Mesh section |
|---|---|
| White | Main Surface Nets mesh |
| Cyan | Horizontal skirt / transition apron |
| Magenta | Vertical skirt |
| Yellow | Transvoxel transition apron (MC+Transvoxel only) |

LOD tint:

| Tint | LOD |
|---|---|
| White (no tint) | LOD0 |
| Dark blue | LOD1 |
| Green | LOD2 |
| Orange | LOD3 / Culled |

### Diagnostic recipe (friend's rule of thumb)

Per [`docs/lod/wireframe-debug-plan.md`](docs/lod/wireframe-debug-plan.md) → WIRE-008:

- **Stepped geometry** in wireframe → DC/QEF/SDF placement issue.
- **Smooth geometry, stepped colour in Alt+F8** → normals issue (not geometry).
- **Holes (no triangles where there should be some)** → missing chunk / failed mesh / wrong dirty flag. Cross-check `missing_boundary_neighbors_at_mesh` in the hole-probe dump.
- **Coloured (non-white) edges visible at an altitude band** → a skirt is being used to hide a real gap. Skirt is a band-aid, not a fix.

# Behavioral guidelines to reduce common LLM coding mistakes. 

Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
