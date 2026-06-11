# CLOD Pages — Rust offline builder (Phase 4)

Standalone (no Bevy) Rust port of the validated Three.js PoC ([tools/clod-poc](../clod-poc)),
per the execution plan ([docs/plans/clod-execution-plan.md](../../docs/plans/clod-execution-plan.md)) §6/§11.
Kept out of the main crate so it compiles in seconds and is unit-testable; when integrated
it maps onto `src/terrain/pages/`. Consumes the same [config/clod_pages.yaml](../../config/clod_pages.yaml).

## Build / run

This env lacks the `sccache` the repo `.cargo/config.toml` references, so disable the wrapper:

```bash
cd tools/clod-rs
RUSTC_WRAPPER="" cargo run --bin clod_spike --release          # Phase 0 meshopt FFI spike
RUSTC_WRAPPER="" cargo run --bin clod_build  --release -- 8    # full 8x8 build + gate verdict
RUSTC_WRAPPER="" cargo test  --release                         # watertight / monotone / A2 guards
```

`clod_build 8` passes every measured Phase 3 gate criterion (A1/A2/A4/A5/A6; A3 is visual)
and matches the JS PoC within epsilon — LOD0 to within 2 triangles of 774k (f32 vs JS f64),
L3 error_world identical.

## Two findings baked in (vs the plan appendix's guesses)

1. **Topological border, not footprint plane** (§11.4): Surface Nets vertices sit inside
   cells, so the outer border is non-planar — `lock.rs`/`validate.rs` detect it via open
   (topological) edges.
2. **meshopt attribute stride is BYTES** (`simplify.rs`): the `meshopt` crate / C API takes
   `vertex_attributes_stride` in bytes (`n_floats * 4`), unlike the JS npm wrapper (floats).
   Passing floats silently blocks all collapses (0% reduction).

The `meshopt` 0.6.2 crate already exposes `simplify_with_attributes_and_locks` +
`simplify_scale` + `SimplifyOptions::LockBorder`, so no raw meshopt-sys FFI is needed.

## Module map (= tools/clod-poc/src, = future src/terrain/pages/)

`terrain.rs` (synthetic field + per-chunk Surface Nets) · `source_mesh.rs` (LOD0 = welded
chunks) · `weld.rs` · `lock.rs` · `simplify.rs` (sole meshopt boundary) · `quadtree.rs`
(merge→weld→lock→simplify→error accumulation) · `validate.rs` · `config.rs`.

Not yet done: integration into the Bevy crate (Phase 5 — runtime selection, near-field
ownership, edit invalidation §Phase 6).
