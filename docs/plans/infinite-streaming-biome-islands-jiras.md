# Infinite Streaming + Multi-Biome Islands — JIRA Breakdown & Executor Prompts

Actionable ticket breakdown for building a huge, streaming, **Valheim-style multi-biome island world** in `tools/clod-poc`, where the playable area follows the camera and the far shell is never reached. Each ticket has acceptance criteria and a **ready-to-paste AI execution prompt**.

> Companion narrative: see the Context/design summary in this file's **Background** section. First executor task (ISLE-1) writes the long-form design doc `docs/plans/infinite-streaming-biome-islands-plan.md`.

---

## Background (shared context — every executor MUST read this)

**Why:** `docs/reference/fable5-world-demo` is *not* infinite — it is a fixed 4096 m world (quadtree always rebuilds from world center; far shell is a static ring at the origin from ~1.95 km to 14 km). clod-poc's default `?world=N` mirrors that. clod-poc *also* has an opt-in **streaming-ownership path** (`?scene=infinite-*`) with camera-following concentric rings (live chunks `<` CLOD pages `<` far-shell annulus), but it is only partly wired and has **no biomes and no island shaping**. This epic builds the missing island/biome generation on top of the streaming path and finishes wiring it so the playable area adapts to the player and the far shell recedes forever.

**Decisions (locked):**
1. **World model = `WorldSource` abstraction** — one streaming pipeline, swappable source: procedural now, pre-baked many-km voxel map later; bounded ocean rim is a config toggle.
2. **Biome layout = discrete Valheim-style regions** — region/distance + elevation, with low-freq noise to break perfect rings.
3. **Biome textures = authored PBR sets per biome via texture-array splat.**

**Hard invariants every executor must respect:**
- **Parity-locked height triplet.** `tools/clod-poc/src/gpu/terrain_field_core.ts` is byte-pinned to CPU `tools/clod-poc/src/terrain/terrain.ts` and to the WGSL field shader named in that file's header (`shaders/terrain_field_common.wgsl`), guarded by `tools/clod-poc/src/gpu/terrain_field_core.test.ts`. **Any change to terrain HEIGHT must be made in all three in lockstep and the parity test re-pinned.** Biome-id and splat-weight layers live *above* the SDF and are additive/safe.
- **One `TerrainSummaryField`** (`tools/clod-poc/src/clod/terrain_summary.ts`) feeds far shell + canopy + shadow. **Do not raise cull distance.** Far-shell inner radius must stay `>=` CLOD radius (`streamer_far_shell_ownership_ok == 1`).
- **Vite tooling runs with `npm`, NEVER `rtk`** (rtk silently breaks vitest/vite build). Only `tsc` typecheck is safe under rtk. A running dev server locks `node_modules/.vite` + `@rollup/*.node` — stop it before any reinstall.
- **Profiling stays in the loop** (CLAUDE.md): every code ticket ends on a deterministic shot/battery or test gate. Use the shot harness + `window.__drusnielClod`.
- **Known pitfall:** DataArrayTexture splat must round the `.depth()` layer index (interpolated index → speckle).

**Standard verification commands:**
```powershell
rtk npm --prefix tools/clod-poc run typecheck   # tsc only — rtk OK
npm --prefix tools/clod-poc test                # vitest — NO rtk
npm --prefix tools/clod-poc run build           # vite build — NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1   # server for shot harness
```

---

## Ticket index

| Epic | Key | Summary | Depends on |
|------|-----|---------|-----------|
| **E0 Measurement gate** | ISLE-1 | Author long-form design doc | — |
| | ISLE-2 | `infinite-islands` scene + scripted walk | ISLE-1 |
| | ISLE-3 | Walk-battery + acceptance counters | ISLE-2 |
| **E1 WorldSource** | ISLE-4 | `WorldSource` interface + 2 impls | ISLE-1 |
| | ISLE-5 | Plumb `?seed=` + sea level via config | ISLE-4 |
| **E2 Island height (triplet)** | ISLE-6 | Island masks + ocean rim in parity triplet | ISLE-5 |
| | ISLE-7 | Inter-island coastlines (beach/cliff) | ISLE-6 |
| **E3 Biome regions** | ISLE-8 | `BiomeRegionField` (CPU TS) | ISLE-5 |
| | ISLE-9 | `BiomeRegionField` WGSL mirror | ISLE-8 |
| | ISLE-10 | Biome content schema → spatial regions | ISLE-8 |
| **E4 Splat material** | ISLE-11 | Biome splat blend in terrain TSL node | ISLE-9, ISLE-10 |
| | ISLE-12 | Author per-biome PBR texture sets | ISLE-11 |
| **E5 Wire streaming** | ISLE-13 | All rings follow camera; far-shell `moveTo` | ISLE-3, ISLE-6 |
| | ISLE-14 | TerrainSummaryField ← WorldSource; biome horizon | ISLE-13, ISLE-9 |
| | ISLE-15 | Streaming walk-battery acceptance | ISLE-14, ISLE-12 |
| **E6 Precision (cond.)** | ISLE-16 | Floating-origin rebasing (unbounded only) | ISLE-15 |
| **E7 Bevy port (later)** | ISLE-17 | Port WorldSource + biomes + splat to Bevy | ISLE-15 |

**First shippable milestone = ISLE-1 … ISLE-15.** ISLE-16 conditional; ISLE-17 later.

---

# EPIC E0 — Measurement gate & design doc

## ISLE-1 — Author the long-form design doc
**Type:** Story · **Epic:** E0 · **Depends on:** —

**Description:** Produce `docs/plans/infinite-streaming-biome-islands-plan.md` capturing the Background above plus per-phase design detail, the critical-files list, and the verification strategy. This is the canonical reference every later ticket links to.

**Acceptance criteria:**
- [ ] File exists with: Context, locked decisions, parity-triplet constraint, phase-by-phase design (E1–E7), critical files, verification, risks.
- [ ] Cross-links the JIRA keys in this file.
- [ ] No reference codename leaks into any code comments later (doc may discuss the reference by folder path only).

**AI execution prompt:**
```
Read docs/plans/infinite-streaming-biome-islands-jiras.md (the Background section and ticket index) and CLAUDE.md. Write docs/plans/infinite-streaming-biome-islands-plan.md: a long-form design doc for a streaming, multi-biome, Valheim-style island world in tools/clod-poc. Cover: (1) why (reference fable5-world-demo is a bounded 4 km world, not infinite; clod-poc's streaming-ownership path is the foundation); (2) the locked decisions (WorldSource abstraction, discrete biome regions, authored PBR splat); (3) the parity-locked height triplet constraint; (4) per-phase design matching epics E1–E7; (5) critical files; (6) verification via the clod-poc shot/battery harness; (7) risks. Reference the JIRA keys. This is a docs-only task — do not modify code. Keep it scannable.
```

## ISLE-2 — `infinite-islands` deterministic scene + scripted long walk
**Type:** Task · **Epic:** E0 · **Depends on:** ISLE-1

**Description:** Add a streaming scene `infinite-islands` (name must start with `infinite-` so the streaming-ownership path activates — see `clod_poc_bootstrap.ts` `streamingScene` gate) to `tools/clod-poc/config/infinite_streaming_phase0.yaml`, with a scripted camera that walks several km in a straight line then turns. Extend config parsing if needed.

**Acceptance criteria:**
- [ ] `?scene=infinite-islands` boots, `streamingScene` resolves true.
- [ ] Scripted camera config (`mode: scripted`, `speed_mps`, `direction_degrees`, `duration_seconds`) parses via `parsePhase0Config`.
- [ ] `npm --prefix tools/clod-poc test` green; typecheck green.

**AI execution prompt:**
```
Obey the Shared Context in docs/plans/infinite-streaming-biome-islands-jiras.md. Add a deterministic streaming scene named `infinite-islands` to tools/clod-poc/config/infinite_streaming_phase0.yaml with a scripted camera that walks several km straight then turns. The name must start with `infinite-` so the streaming-ownership path activates (see streamingScene gate in tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts:140 and Phase0SceneCameraConfig in tools/clod-poc/src/phase0/phase0_config.ts). Extend phase0 config parsing only if a needed field is missing. Verify: `rtk npm --prefix tools/clod-poc run typecheck` then `npm --prefix tools/clod-poc test` (NO rtk). Do not touch terrain math.
```

## ISLE-3 — Walk-battery shot + acceptance counters
**Type:** Task · **Epic:** E0 · **Depends on:** ISLE-2

**Description:** Add a shot/battery entry that drives the `infinite-islands` scripted walk and records stats (fps, frame ms, ownership counters, hole/seam metrics) via `window.__drusnielClod.stats`. Establish the baseline acceptance thresholds used by ISLE-15.

**Acceptance criteria:**
- [ ] Battery run produces a stats JSON for `infinite-islands`.
- [ ] Captures `streamer_live_radius_m`, `streamer_clod_radius_m`, `streamer_far_shell_inner_m/outer_m`, `streamer_far_shell_ownership_ok`, plus frame-ms p50/p95.
- [ ] Documents thresholds: no stall >8 ms, `ownership_ok==1`, zero ring-boundary holes.

**AI execution prompt:**
```
Obey the Shared Context. Add a Playwright shot/battery entry under tools/clod-poc that runs the `infinite-islands` scripted walk and records window.__drusnielClod.stats (fps, frame ms p50/p95, and the streamer_* ownership counters). Wire it like the existing shoot/battery scripts (see CLAUDE.md "Shot Harness" section). Write the captured stats JSON under shots/. Document acceptance thresholds in the battery: no stall >8 ms, streamer_far_shell_ownership_ok==1, zero ring-boundary holes. Start the dev server first: `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1`. Use npm, never rtk, for the harness.
```

---

# EPIC E1 — WorldSource abstraction + seed/sea-level plumbing

## ISLE-4 — `WorldSource` interface + procedural impl + streamed stub
**Type:** Story · **Epic:** E1 · **Depends on:** ISLE-1

**Description:** Introduce `tools/clod-poc/src/world_source/world_source.ts` defining `WorldSource` (`sampleHeight(x,z)`, `sampleBiome(x,z)`, `oceanMask(x,z)`, metadata `{ seed, seaLevel, bounds|infinite, oceanRim }`). Add `ProceduralWorldSource` that wraps the existing field (delegates `sampleHeight` to the current core for now) and a thin `StreamedVoxelWorldSource` stub (future pre-baked map) so the contract is real and unit-tested.

**Acceptance criteria:**
- [ ] `WorldSource` interface + both impls compile and are unit-tested.
- [ ] `ProceduralWorldSource.sampleHeight` returns identical values to today's field (delegation, no math change).
- [ ] No change to the parity triplet in this ticket.

**AI execution prompt:**
```
Obey the Shared Context (esp. the parity-locked height triplet — do NOT change terrain math here). Create tools/clod-poc/src/world_source/world_source.ts with a `WorldSource` interface: sampleHeight(x,z), sampleBiome(x,z), oceanMask(x,z), and metadata { seed, seaLevel, bounds|infinite, oceanRim }. Add `ProceduralWorldSource` that delegates sampleHeight to the existing core (tools/clod-poc/src/gpu/terrain_field_core.ts surfaceHeightCore) and stubs sampleBiome/oceanMask, and a minimal `StreamedVoxelWorldSource` stub. Add a vitest unit test asserting ProceduralWorldSource.sampleHeight matches surfaceHeightCore for sample points. Verify: typecheck (rtk ok) then `npm --prefix tools/clod-poc test` (NO rtk).
```

## ISLE-5 — Plumb `?seed=` and sea level through config
**Type:** Task · **Epic:** E1 · **Depends on:** ISLE-4

**Description:** Replace the hardcoded `TERRAIN_SEED = 0` ([terrain_field_core.ts:19](../../tools/clod-poc/src/gpu/terrain_field_core.ts#L19)) and `WATER_LEVEL = 18` ([terrain_field_core.ts:16](../../tools/clod-poc/src/gpu/terrain_field_core.ts#L16)) with parameters sourced from config/URL, defaulting to today's values. Thread them through the parity triplet and `WorldSource` metadata.

**Acceptance criteria:**
- [ ] `?seed=N` changes generated terrain; default (`seed=0`, `seaLevel=18`) is byte-identical to current output.
- [ ] Parameter exists in all three triplet representations consistently; parity test re-pinned and green.
- [ ] Typecheck + tests green.

**AI execution prompt:**
```
Obey the Shared Context — this ticket DOES touch the parity triplet, so edit all three in lockstep: tools/clod-poc/src/terrain/terrain.ts (CPU), tools/clod-poc/src/gpu/terrain_field_core.ts (GPU-shaped spec), and the WGSL field shader named in terrain_field_core.ts's header (shaders/terrain_field_common.wgsl). Replace hardcoded TERRAIN_SEED=0 and WATER_LEVEL=18 with parameters from config/URL, defaulting to those exact values so default output is unchanged. Expose them on WorldSource metadata (ISLE-4). Re-pin tools/clod-poc/src/gpu/terrain_field_core.test.ts after confirming default parity. Verify the parity test and full suite: `npm --prefix tools/clod-poc test` (NO rtk). Then confirm `?seed=1` visibly changes terrain in the shot harness.
```

---

# EPIC E2 — Island shaping + ocean rim (HEIGHT layer — parity triplet)

## ISLE-6 — Island/continent masks + optional ocean rim in the parity triplet
**Type:** Story · **Epic:** E2 · **Depends on:** ISLE-5

**Description:** Add big-island shaping (low-freq domain-warped masks + per-island radial falloff) and an optional bounded ocean rim (clamp height below sea level beyond `world_radius_m`) into the height field, **in lockstep across the triplet**. Re-pin the parity test. Expose island/rim params via config + `WorldSource` metadata. This is the riskiest ticket — isolate it.

**Acceptance criteria:**
- [ ] Big islands separated by ocean appear in the meshed terrain (CPU and GPU mesh agree).
- [ ] Ocean-rim toggle clamps terrain below sea level past `world_radius_m`; off = unbounded.
- [ ] `terrain_field_core.test.ts` re-pinned; CPU/GPU parity green.
- [ ] Coastline shot captured; bench of `infinite-islands` recorded vs. pre-change baseline.

**AI execution prompt:**
```
Obey the Shared Context. This changes terrain HEIGHT, so edit the parity triplet in lockstep: tools/clod-poc/src/terrain/terrain.ts, tools/clod-poc/src/gpu/terrain_field_core.ts, and the WGSL field shader (shaders/terrain_field_common.wgsl). Add: (1) big-island shaping via low-frequency domain-warped masks + per-island radial falloff producing distinct islands separated by ocean; (2) an optional bounded ocean rim that clamps height below sea level beyond a config `world_radius_m`. Source params from config + WorldSource metadata (ISLE-4/5). Keep CPU and GPU math byte-identical; re-pin tools/clod-poc/src/gpu/terrain_field_core.test.ts only after verifying parity. Verify: `npm --prefix tools/clod-poc test` (NO rtk), then capture a coastline shot and a bench of ?scene=infinite-islands via the harness (server: npm ... run dev). Do this ticket in isolation from biome work.
```

## ISLE-7 — Inter-island coastlines (beach/cliff)
**Type:** Task · **Epic:** E2 · **Depends on:** ISLE-6

**Description:** Extend the existing coastline system (`tools/clod-poc/src/terrain/border_coast.ts`, `tools/clod-poc/src/border/coastMask.ts`, `tools/clod-poc/config/border_coast_ocean.yaml`) — currently world-edge only — to apply beach/cliff treatment at *inter-island* shorelines driven by the island mask from ISLE-6.

**Acceptance criteria:**
- [ ] Beaches and cliffs render along island shorelines, not just the world edge.
- [ ] Coast type selection (beach vs. cliff) still deterministic.
- [ ] Tests + typecheck green; shoreline shot captured.

**AI execution prompt:**
```
Obey the Shared Context. Extend the coastline system (tools/clod-poc/src/terrain/border_coast.ts, tools/clod-poc/src/border/coastMask.ts, tools/clod-poc/config/border_coast_ocean.yaml) so beach/cliff treatment applies at inter-island shorelines using the island mask from ISLE-6, not only the single world edge. If shoreline height blends touch terrain height, mirror across the parity triplet and re-pin the test; if it's material-only, keep it above the SDF. Verify with `npm --prefix tools/clod-poc test` and a shoreline shot.
```

---

# EPIC E3 — Discrete biome region field

## ISLE-8 — `BiomeRegionField` (CPU TS)
**Type:** Story · **Epic:** E3 · **Depends on:** ISLE-5

**Description:** Implement `tools/clod-poc/src/world_source/biome_region_field.ts`: assigns a biome id per world cell Valheim-style — region/distance-from-island-center + elevation bands + low-freq region noise to break perfect rings. Fully deterministic (`pcg2d(cell, seed)`). Wire into `ProceduralWorldSource.sampleBiome`.

**Acceptance criteria:**
- [ ] Deterministic biome id per `(x,z,seed)`; unit-tested for stability and region coverage.
- [ ] Distinct biome regions visible in a debug overlay (ISLE-10).
- [ ] Additive only — no SDF/parity changes.

**AI execution prompt:**
```
Obey the Shared Context. Create tools/clod-poc/src/world_source/biome_region_field.ts assigning a biome id per world cell, Valheim-style: region/distance-from-island-center + elevation bands + a low-frequency region noise that breaks perfect concentric rings. Make it fully deterministic with pcg2d(cell, seed). Wire it into ProceduralWorldSource.sampleBiome (ISLE-4). This is additive — do NOT change the height triplet. Add vitest tests for determinism and that all expected biomes get coverage. Verify: typecheck (rtk ok) + `npm --prefix tools/clod-poc test` (NO rtk).
```

## ISLE-9 — `BiomeRegionField` WGSL mirror
**Type:** Task · **Epic:** E3 · **Depends on:** ISLE-8

**Description:** Port `BiomeRegionField` to WGSL so the terrain material (ISLE-11) and far shell (ISLE-14) classify biomes on-GPU identically. Classification is tolerant (not byte-pinned like the SDF) but must visually match CPU at near/far boundaries.

**Acceptance criteria:**
- [ ] WGSL biome classifier matches CPU output at sampled cells (test or visual parity shot).
- [ ] No near-vs-far biome mismatch at the streamed/summary boundary.

**AI execution prompt:**
```
Obey the Shared Context. Port the BiomeRegionField logic from tools/clod-poc/src/world_source/biome_region_field.ts to WGSL for use by the terrain material and far shell. Keep the algorithm aligned with the CPU version (same pcg2d, same region/elevation/noise rules). Add a parity check (sample a grid of cells CPU vs GPU, or a visual parity shot) to confirm no near/far biome mismatch. Verify with the shot harness + `npm --prefix tools/clod-poc test`.
```

## ISLE-10 — Biome content schema → spatial regions + debug overlay
**Type:** Task · **Epic:** E3 · **Depends on:** ISLE-8

**Description:** Extend biome content from static height-bands to spatial regions: `tools/clod-poc/src/content/types.ts` (`BiomeContent`), `tools/clod-poc/config/content/biomes.yaml`, `tools/clod-poc/src/content/registry.ts`, `tools/clod-poc/src/content/validate.ts`. Each biome references its texture-slot set (consumed in ISLE-11/12). Add a debug overlay coloring terrain by biome id.

**Acceptance criteria:**
- [ ] Each biome region maps to a content entry + texture-slot set; validation passes.
- [ ] Debug overlay shows biome regions; biomes.yaml documents the Valheim-style set (e.g. meadows, forest, swamp, mountain, plains).
- [ ] Content tests green.

**AI execution prompt:**
```
Obey the Shared Context. Extend the biome content model from static height-bands to spatial biome regions across tools/clod-poc/src/content/types.ts, tools/clod-poc/config/content/biomes.yaml, tools/clod-poc/src/content/registry.ts, tools/clod-poc/src/content/validate.ts. Each biome must reference a texture-slot set for the splat material (ISLE-11/12). Author a Valheim-style biome set (meadows, forest, swamp, mountain, plains, etc.). Add a debug overlay that colors terrain by the biome id from BiomeRegionField (ISLE-8). Verify content with `npm --prefix tools/clod-poc test` and a biome-overlay shot.
```

---

# EPIC E4 — Authored PBR splat material per biome

## ISLE-11 — Biome splat blend in terrain TSL node
**Type:** Story · **Epic:** E4 · **Depends on:** ISLE-9, ISLE-10

**Description:** Reuse the existing array-texture path (`tools/clod-poc/src/textures/terrainTextureArrays.ts`, `tools/clod-poc/src/gpu/terrain_node_material.ts`, `tools/clod-poc/src/terrain/material/terrain_texture_controller.ts`, content registry). Build a biome→array-layer map; the terrain TSL node splat-blends albedo/normal/roughness from the array by biome weight (from `BiomeRegionField`) + slope/height. Triplanar; **round the array layer index** to avoid speckle.

**Acceptance criteria:**
- [ ] Terrain shows distinct per-biome PBR materials, blended across region boundaries.
- [ ] **No array-index speckle** (verify with albedo-off debug = clean).
- [ ] Frame-ms delta vs. ISLE-10 baseline recorded.

**AI execution prompt:**
```
Obey the Shared Context — including the DataArrayTexture pitfall: ROUND the .depth()/layer index, never sample it interpolated, or you get speckle. Reuse the existing array-texture splat path (tools/clod-poc/src/textures/terrainTextureArrays.ts, tools/clod-poc/src/gpu/terrain_node_material.ts, tools/clod-poc/src/terrain/material/terrain_texture_controller.ts, content registry). Build a biome→array-layer map and splat-blend albedo/normal/roughness in the terrain TSL node by biome weight (from the WGSL BiomeRegionField, ISLE-9) plus slope/height, triplanar. Verify per-biome shots, confirm albedo-off debug is clean (no speckle), and record the frame-ms delta vs the ISLE-10 baseline via the harness.
```

## ISLE-12 — Author per-biome PBR texture sets
**Type:** Task · **Epic:** E4 · **Depends on:** ISLE-11

**Description:** Produce/import albedo+normal+roughness sets for each biome and load them into `terrainTextureArrays`. Keep memory budget in check (resolution/format).

**Acceptance criteria:**
- [ ] Each biome has a complete texture set loaded into the array.
- [ ] Texture memory budget documented; build + load succeed.
- [ ] Per-biome visual shots look correct (no wrong-biome bleed).

**AI execution prompt:**
```
Obey the Shared Context. Author or import albedo/normal/roughness texture sets for every biome defined in ISLE-10 and load them into tools/clod-poc/src/textures/terrainTextureArrays.ts. Keep resolution/format within a documented memory budget. Verify `npm --prefix tools/clod-poc run build` (NO rtk) and capture per-biome shots confirming correct materials and no cross-biome bleed.
```

---

# EPIC E5 — Wire streaming-ownership as the default for the islands scene

## ISLE-13 — All rings follow the camera; close the far-shell `moveTo` gap
**Type:** Story · **Epic:** E5 · **Depends on:** ISLE-3, ISLE-6

**Description:** For `infinite-islands`, drive every ring off the camera each frame: live chunks (already follow via `bubbleCenter`), CLOD page tree centered on camera, and the **far-shell annulus repositioned via `moveTo()` each frame** (the gap — `moveTo` exists in `far_shell_controller.ts` but has no frame-loop caller). Use the inner-exclusion annulus (`farShellInnerRadiusForOwnership`) so the far shell never overlaps playable terrain and recedes with the player.

**Acceptance criteria:**
- [ ] Walking, the live + CLOD + far-shell rings all recenter on the camera; far shell never reached.
- [ ] `streamer_far_shell_ownership_ok == 1` throughout the walk.
- [ ] No holes/seams at ring boundaries.

**AI execution prompt:**
```
Obey the Shared Context. In the infinite-islands streaming path, make every terrain ring follow the camera each frame. Live chunks already follow (tools/clod-poc/src/app/frame_loop/terrain_frame_phase.ts bubbleCenter). Center the CLOD page selection on the camera, and CLOSE THE GAP: call FarShellController.moveTo(x,z) every frame from the frame loop (tools/clod-poc/src/app/frame_loop/clod_frame_loop.ts / terrain_frame_phase.ts), using the inner-exclusion annulus from tools/clod-poc/src/streaming/streaming_ownership.ts (farShellInnerRadiusForOwnership) so the far shell never overlaps playable terrain. Keep far-shell inner >= CLOD radius. Verify with the scripted walk battery (ISLE-3): assert streamer_far_shell_ownership_ok==1 and no ring-boundary holes for the whole traverse.
```

## ISLE-14 — TerrainSummaryField ← WorldSource; biome on the horizon
**Type:** Task · **Epic:** E5 · **Depends on:** ISLE-13, ISLE-9

**Description:** Point the single `TerrainSummaryField` at the `WorldSource` (analytic) for cells beyond the streamed region (reuse `sampleSkirtHeight` in `gpu/far_terrain_shell.ts`) so distant islands appear on the horizon. Feed biome id into far-shell + canopy color so distant biomes read correctly.

**Acceptance criteria:**
- [ ] Distant islands/biomes visible on the horizon and consistent with near terrain.
- [ ] Far shell + canopy colored by biome; no near/far biome mismatch.
- [ ] One `TerrainSummaryField` still serves shell+canopy+shadow (no duplication, no cull-distance increase).

**AI execution prompt:**
```
Obey the Shared Context. Make the single TerrainSummaryField (tools/clod-poc/src/clod/terrain_summary.ts) sample the WorldSource analytically for cells beyond the streamed region, reusing sampleSkirtHeight (tools/clod-poc/src/gpu/far_terrain_shell.ts), so distant islands appear on the horizon. Feed biome id (WGSL BiomeRegionField, ISLE-9) into the far-shell and canopy color. Keep ONE TerrainSummaryField feeding shell+canopy+shadow and do NOT raise cull distance. Verify horizon islands + biome-tinted far shell via shots, and confirm no near/far biome seam.
```

## ISLE-15 — Streaming walk-battery acceptance
**Type:** Task · **Epic:** E5 · **Depends on:** ISLE-14, ISLE-12

**Description:** Run the full `infinite-islands` scripted multi-km walk and assert the milestone acceptance: continuous streaming, all biomes traversed with correct textures, far shell receding, no stall >8 ms, ownership_ok, no holes.

**Acceptance criteria:**
- [ ] Multi-km walk completes with no stall >8 ms (frame-ms p95 within threshold).
- [ ] `ownership_ok==1`, zero ring-boundary holes, far shell never reached.
- [ ] Stats JSON + shots archived; results summarized (scene, before/after counters).

**AI execution prompt:**
```
Obey the Shared Context. Run the infinite-islands scripted multi-km walk battery (ISLE-3) end to end. Assert: continuous streaming with no stall >8 ms (report frame-ms p50/p95), streamer_far_shell_ownership_ok==1 for the whole walk, zero ring-boundary holes, far shell never reached, and all biomes traversed with their authored textures. Server first: npm --prefix tools/clod-poc run dev -- --host 127.0.0.1. Archive the stats JSON + shots and summarize the scene + counters per CLAUDE.md "Reporting".
```

---

# EPIC E6 — Far-from-origin precision (conditional)

## ISLE-16 — Floating-origin rebasing (unbounded mode only)
**Type:** Story · **Epic:** E6 · **Depends on:** ISLE-15

**Description:** Bounded ocean-rim worlds don't need this. For unbounded-procedural runs, add floating-origin rebasing: shift the scene origin past a snap threshold, rebase render coordinates, keep world coordinates in f64. Gate behind the unbounded toggle.

**Acceptance criteria:**
- [ ] Walking far from origin (many km) in unbounded mode shows no vertex jitter/precision artifacts.
- [ ] Bounded mode path unaffected.
- [ ] Rebase is seamless (no visible pop on origin shift).

**AI execution prompt:**
```
Obey the Shared Context. Only for the unbounded WorldSource mode, add floating-origin rebasing: when the camera crosses a snap threshold, shift the scene origin and rebase render coordinates while keeping world coordinates in f64. Leave the bounded ocean-rim path untouched. Verify by walking many km in unbounded mode in the shot harness: no vertex jitter, no pop on origin shift.
```

---

# EPIC E7 — Bevy port (later)

## ISLE-17 — Port WorldSource + BiomeRegionField + splat to Bevy
**Type:** Story · **Epic:** E7 · **Depends on:** ISLE-15

**Description:** Mirror `WorldSource`, `BiomeRegionField`, island/ocean-rim shaping, and the splat material into the Bevy crate, sharing the single-`TerrainSummaryField` pattern (Phase B structure of `docs/plans/four-km-long-view-plan.md`). Out of scope for the first milestone.

**Acceptance criteria:**
- [ ] Bevy terrain renders the same islands/biomes/materials as clod-poc for a fixed seed.
- [ ] Bench parity vs. clod-poc reference scene; profiling per CLAUDE.md "Performance Expectations".

**AI execution prompt:**
```
Obey CLAUDE.md performance rules (use cargo run --release -- --bench ...; do not run visual benches from WSL; compare bench-runs/<run>/summary.json before/after). Port the clod-poc WorldSource, BiomeRegionField, island/ocean-rim height shaping, and the per-biome splat material into the Bevy crate, sharing the single TerrainSummaryField pattern (see docs/plans/four-km-long-view-plan.md Phase B). For a fixed seed, match clod-poc's islands/biomes/materials. Report the bench scene + before/after numbers + which counters moved. Do not leak the reference codename into code comments.
```

---

## Suggested sprint slicing

- **Sprint 1 (foundation):** ISLE-1, ISLE-2, ISLE-3, ISLE-4, ISLE-5.
- **Sprint 2 (world shape):** ISLE-6, ISLE-7, ISLE-8, ISLE-9, ISLE-10.
- **Sprint 3 (look + wiring):** ISLE-11, ISLE-12, ISLE-13, ISLE-14, ISLE-15 → **milestone demo**.
- **Backlog:** ISLE-16 (if unbounded), ISLE-17 (Bevy).
