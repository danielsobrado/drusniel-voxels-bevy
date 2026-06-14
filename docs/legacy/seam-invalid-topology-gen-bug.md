# LOD Seam `InvalidUnsafeTopology` faces — suspected generation bug

**Status:** TODO (deferred). Known issue, **not** the visual lip/hole seam artifacts under active
investigation. Captured here so they are not re-discovered from scratch.

## What these are

The deterministic [LOD seam audit](./lod-seam-audit-implementation.md) classifies every active
X/Z seam face. On the hard-case fixture, **6 faces** land in `final_mode = InvalidUnsafeTopology`:
a *real* LOD transition where the seam could be neither stitched nor skirted, so the audit cannot
prove the seam is watertight.

Per the audit contract, a face is `InvalidUnsafeTopology` when a real LOD transition needs strip
data but it is unsafe to stitch (**missing coarse strip** → `coarse_components = 0`, or a
**multi-component fine boundary** → `fine_components ≠ 1`) **and** no skirt fallback was emitted
(`skirt_triangle_count = 0`). The morph still welds (`sealed_by_mask = true`), but with no strip
to verify against and no skirt, the seam is left in an unverified state.

These come from the **sculpted hard-case fixture** (`lod_seam_hard_case_fixture = true`), so the
root cause is in **the geometry that produces these chunks** — i.e. the fixture/world-generation
that sculpts this region — not in the meshing/seam path itself.

## The 6 faces (chunk coordinates)

Chunk coords; world-voxel origin = `chunk * 16` (CHUNK_SIZE), extent `+16`.

| # | source chunk | neighbour chunk | face | fine→coarse LOD | strip status | fine/coarse comps | morph welded/cand | reject reason |
|---|---|---|---|---|---|---|---|---|
| 1 | `(4, 3, 26)` | `(5, 3, 26)` | pos_x | Lod0→Lod1 | MissingStrip | 1 / 0 | 5 / 6 | MissingStrip |
| 2 | `(4, 4, 26)` | `(4, 4, 27)` | pos_z | Lod1→Lod2 | MissingStrip | 1 / 0 | 3 / 3 | MissingStrip |
| 3 | `(5, 3, 27)` | `(5, 3, 26)` | neg_z | Lod0→Lod1 | MissingStrip | 1 / 0 | 71 / 87 | MissingStrip |
| 4 | `(5, 4, 27)` | `(4, 4, 27)` | neg_x | Lod1→Lod2 | MissingStrip | 1 / 0 | 18 / 18 | MissingStrip |
| 5 | `(21, 4, 6)` | `(21, 4, 5)` | neg_z | Lod0→Lod1 | HitCurrentRevision | **2** / 1 | 246 / 246 | MultiComponentStrip |
| 6 | `(22, 3, 6)` | `(23, 3, 6)` | pos_x | Lod0→Lod1 | MissingStrip | 1 / 0 | 6 / 6 | MissingStrip |

### Two spatial clusters

- **Cluster A** — chunks `(4–5, 3–4, 26–27)` → world voxels ≈ **X 64–96, Y 48–80, Z 416–448**.
  Faces 1–4. All `MissingStrip` (coarse neighbour exported no boundary strip).
- **Cluster B** — chunks `(21–23, 3–4, 6)` → world voxels ≈ **X 336–368, Y 48–80, Z 96–112**.
  Faces 5–6. Face 5 is the lone **multi-component fine boundary** (`fine_components = 2`) — the
  surface splits into two sheets across the seam (overhang / pinch / detached blob), which is the
  fingerprint of a topology defect in the source voxels.

## TODO — fix the generation that sculpts these chunks

- [ ] **Identify the source geometry.** For each cluster, inspect the voxels the
      fixture/world-gen writes in the world-voxel AABBs above. Cluster B face 5 is the priority:
      `fine_components = 2` means two disconnected solid sheets meet at one chunk face — almost
      certainly an unintended detached/overhang blob from the sculpt.
- [ ] **Cluster A (`MissingStrip`, coarse side empty).** `coarse_components = 0` means the
      coarse neighbour produced **no boundary surface** on the shared face while the fine side did.
      Check whether the generator leaves a one-voxel-thin or sub-coarse-sample feature there that
      vanishes at Lod1/Lod2 — i.e. geometry below the coarse LOD's representable scale. Either
      thicken it past the coarse sampling step or remove it.
- [ ] **Cluster B face 5 (`MultiComponentStrip`).** Find and remove the second solid component
      (detached sheet/overhang) so the fine boundary is a single connected chain.
- [ ] **Re-run the audit and confirm `InvalidUnsafeTopology` faces → 0** (see steps below).
- [ ] If these faces are *intended* terrain (genuine thin features / overhangs), the fix is instead
      meshing-side: emit a skirt fallback for `InvalidUnsafeTopology` so the seam is at least
      sealed. Decide gen-fix vs meshing-fallback once the source voxels are inspected.

## Steps to identify / reproduce

1. Build + run the hard-case seam-audit bench:
   ```powershell
   cargo run --release -- --bench bench/scenes/lod-seam-hard-cases.toml
   ```
2. Find the latest `seam-audit.json`:
   ```powershell
   Get-ChildItem bench-runs -Recurse -Filter seam-audit.json |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
   ```
3. List the offending faces (chunk coords + why):
   ```powershell
   $j = Get-Content '<path>\seam-audit.json' -Raw | ConvertFrom-Json
   $j.faces | Where-Object { $_.final_mode -eq 'InvalidUnsafeTopology' } |
     Select-Object source_chunk, neighbor_chunk, face, fine_lod, coarse_lod,
       fine_components, coarse_components, strip_reject_reason
   ```
4. To inspect in-game, fly to the world-voxel AABBs above (`chunk * 16`), freeze LOD with
   **Alt+F6**, and dump a probe with **Alt+F10** at the seam.
5. **Done when:** `summary.partial_morph_uncovered_faces` and the `InvalidUnsafeTopology` count
   are both `0` on this fixture.

## Source pointers

- Audit classification: [`src/voxel/meshing/seam_audit.rs`](../../src/voxel/meshing/seam_audit.rs)
- Hard-case fixture: [`src/voxel/diagnostics/lod_seam_hard_case_fixture.rs`](../../src/voxel/diagnostics/lod_seam_hard_case_fixture.rs)
- Bench scene: [`bench/scenes/lod-seam-hard-cases.toml`](../../bench/scenes/lod-seam-hard-cases.toml)
- Captured from run `bench-runs/2026-06-08T12-20-06Z/seam-audit.json` (schema 3).
