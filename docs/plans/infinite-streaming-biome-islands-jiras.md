# EPIC E5 — Wire streaming-ownership as the default for the islands scene

## ISLE-13 — All rings follow the camera; close the far-shell `moveTo` gap; one-owner invariant
**Type:** Story · **Epic:** E5 · **Depends on:** ISLE-3b, ISLE-6

**Description:** For `infinite-islands`, drive every ring off the camera each frame: live chunks (already follow via `bubbleCenter`), CLOD page tree centered on camera, and the **far-shell annulus repositioned via `moveTo()` each frame** (the gap — `moveTo` exists in `far_shell_controller.ts` but has no frame-loop caller). Use the inner-exclusion annulus (`farShellInnerRadiusForOwnership`) so the far shell never overlaps playable terrain and recedes with the player. **Enforce the invariant: exactly one owner per terrain footprint** — live chunks own the inner bubble, CLOD pages the middle ring, far shell the outer annulus; live/CLOD footprints must be mutually exclusive (overlap-fading identical terrain causes z-fighting). The ISLE-3b oracle gates this.

**Acceptance criteria:**
- [ ] Walking, the live + CLOD + far-shell rings all recenter on the camera; far shell never reached.
- [ ] `streamer_far_shell_ownership_ok == 1` throughout the walk.
- [ ] ISLE-3b oracle reports zero `*_gap_holes` and zero `live_clod_overlap_cells` for the whole traverse.

**AI execution prompt:**
```
Obey the Shared Context. In the infinite-islands streaming path, make every terrain ring follow the camera each frame. Live chunks already follow (tools/clod-poc/src/app/frame_loop/terrain_frame_phase.ts bubbleCenter). Center the CLOD page selection on the camera, and CLOSE THE GAP: call FarShellController.moveTo(x,z) every frame from the frame loop (tools/clod-poc/src/app/frame_loop/clod_frame_loop.ts / terrain_frame_phase.ts), using the inner-exclusion annulus from tools/clod-poc/src/streaming/streaming_ownership.ts (farShellInnerRadiusForOwnership) so the far shell never overlaps playable terrain. Enforce exactly one owner per footprint: live chunks own the inner bubble, CLOD pages the middle ring, far shell the outer annulus, and live/CLOD footprints must be mutually exclusive (overlap → z-fight). Keep far-shell inner >= CLOD radius. Verify with the scripted walk battery (ISLE-3) gated by the ISLE-3b oracle: assert streamer_far_shell_ownership_ok==1, zero *_gap_holes, and zero live_clod_overlap_cells for the whole traverse.
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

**Detailed plan:** `docs/plans/bevy-world-source-gpu-first-port-order.md`

**Description:** Mirror `WorldSource`, `BiomeRegionField`, island/ocean-rim shaping, and the splat material into the Bevy crate, sharing the single-`TerrainSummaryField` pattern (Phase B structure of `docs/plans/four-km-long-view-plan.md`). Out of scope for the first milestone. The detailed port plan is GPU-first: CPU and GPU must not diverge, GPU is the default runtime path where supported, and CPU is only a fallback/reference/debug path.

**Acceptance criteria:**
- [ ] Bevy terrain renders the same islands/biomes/materials as clod-poc for a fixed seed.
- [ ] CPU/GPU parity gate proves height/biome/ocean/splat contract does not drift.
- [ ] GPU WorldSource path is the default where supported; CPU path is explicit fallback/reference only.
- [ ] Bench parity vs. clod-poc reference scene; profiling per CLAUDE.md "Performance Expectations".

**AI execution prompt:**
```
Obey CLAUDE.md performance rules (use cargo run --release -- --bench ...; do not run visual benches from WSL; compare bench-runs/<run>/summary.json before/after). Follow docs/plans/bevy-world-source-gpu-first-port-order.md. Port the clod-poc WorldSource, BiomeRegionField, island/ocean-rim height shaping, and the per-biome splat material into the Bevy crate. GPU is the default runtime path where supported. CPU is fallback/reference/debug only. Do not allow CPU and GPU classification/materials to diverge. For a fixed seed, match clod-poc's islands/biomes/materials. Report the bench scene + before/after numbers + which counters moved. Do not leak the reference codename into code comments.
```

---

## Milestones (ordered to make ownership & parity REAL before visual richness)

The original phase order put biomes/materials before the ownership and parity gates were trustworthy — and the committed code shows exactly that hazard (fake holes counter, impure `WorldSource`, CPU↔WGSL biome divergence). Re-sliced:

- **Milestone A — Infinite ownership proof.** ISLE-1, ISLE-2, ISLE-3, **ISLE-3b**, ISLE-4, ISLE-5, **ISLE-5b**, ISLE-13 (rings follow + one-owner invariant), partial ISLE-14 (TerrainSummaryField uses `WorldSource` height only). *Goal: walk forever; rings follow; far shell recedes; oracle proves zero gaps/overlaps. No authored biome textures yet.*
- **Milestone B — Island world shape.** ISLE-6, ISLE-7. *Goal: real islands + ocean rim with full height-triplet parity.*
- **Milestone C — Biomes.** ISLE-8, ISLE-9 (golden-table CPU↔WGSL parity), ISLE-10. *Goal: identical biome classification near/far/CPU/GPU.*
- **Milestone D — Materials.** ISLE-11, ISLE-12. *Goal: real per-biome PBR splat, no speckle.*
- **Milestone E — Acceptance demo.** finish ISLE-14, ISLE-15. *Goal: full long-walk acceptance; archive stats + shots.*
- **Backlog:** ISLE-16 (only if unbounded mode is used), ISLE-17 (Bevy port, after clod-poc proves out; follow the GPU-first detailed plan).

**Rule:** Milestone A's oracle (ISLE-3b) and purity (ISLE-5b) are hard gates — do not start C/D until A passes with measured (not assigned) counters.
