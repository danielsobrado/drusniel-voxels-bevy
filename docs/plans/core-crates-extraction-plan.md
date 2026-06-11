# naadf-core & clod-core — Extraction Plan (Sprints + Tickets + Implementer Prompts)

Goal: extract the engine-agnostic parts of CLOD pages and NAADF into workspace crates
(`crates/clod-core`, `crates/naadf-core`) so one implementation serves the Bevy engine,
the standalone harnesses, and (later) wasm32/WebGPU builds. Stop the copy-drift already
observed (`tools/clod-rs/src/weld.rs` ≠ `src/voxel/pages/weld.rs`).

Non-goals: no behavior changes, no new features, no playground feature work beyond a
compile-proving skeleton, no Path-B compositor extraction (stays Bevy-coupled by design).

Tickets below are formatted for any tracker (paste body as description). IDs are local
(`CORE-n`). Each ticket carries a self-contained **Prompt** for the implementing AI.

---

## 0. Verified repo facts (ground truth for every ticket)

```text
F1. Root Cargo.toml is a single [package] "voxel_builder", edition 2024,
    default features = ["mc_transvoxel", "naadf"]. NO [workspace] yet.
F2. tools/clod-rs is a separate package (edition 2021, lib clod_rs + bin clod_spike),
    NOT a workspace member. Its weld.rs has already diverged from src/voxel/pages/weld.rs.
F3. src/voxel/pages/* near-pure modules: types, weld, lock, validate, source_mesh,
    quadtree, simplify, config. Engine-coupled: export.rs (MeshData, barycentric_section,
    VoxelWorld::chunk_to_world, LodLevel), runtime.rs, plugin.rs, tests.rs (FFI link test).
F4. NAADF layers: build/ 4209 LoC, data/ 3350 LoC, render/ 4904 LoC, root 939 LoC,
    WGSL 4160 LoC (24 files in assets/shaders/naadf/).
F5. NAADF bevy coupling is shallow in build/+data/: bevy::prelude (glam + log macros),
    bevy::diagnostic::FrameCount, bevy::render::MainWorld (extractor.rs only),
    bevy::render::render_resource::{Buffer, BufferDescriptor, BufferUsages} +
    RenderDevice/RenderQueue (gpu_buffers.rs, prepare.rs). gpu_buffers.rs already calls
    raw wgpu (map_async, PollType).
F6. NAADF WGSL uses Bevy/naga_oil composition:
    #import "shaders/naadf/common.wgsl" ITEM, ...  — import keys are ASSET PATHS.
F7. config/clod_pages.yaml is embedded compile-time in src/voxel/pages/config.rs via
    include_str!(CARGO_MANIFEST_DIR/config/clod_pages.yaml). tools/clod-poc also reads it.
F8. meshopt = "0.6" builds C via cc → does NOT build for wasm32-unknown-unknown.
F9. .cargo/config.toml sets rustc-wrapper = sccache; if sccache is absent in the build
    environment, build with RUSTC_WRAPPER="" — never commit a config change for this.
```

## 1. Global rules for the implementing AI (apply to EVERY ticket)

```text
R1. Zero behavior change. This is a refactor program. If a test or visual output
    changes, stop and report — do not "fix forward".
R2. Hard-fail semantics are sacred: every ClodBuildError / validation path keeps
    erroring, never downgraded to warnings.
R3. One ticket = one commit (or small commit series), message "CORE-n: <title>".
R4. After every ticket: cargo fmt --all && cargo clippy --workspace -- -D warnings
    && cargo test --workspace  (use RUSTC_WRAPPER="" if sccache missing, F9).
R5. No public API renames beyond those a ticket lists. Engine call sites change only
    in the ticket that says so.
R6. Core crates must not depend on bevy*, on the engine crate, or read files at
    runtime (include_str!/include_bytes! only).
R7. Logging in core crates uses the `tracing` crate (Bevy forwards to tracing, so
    engine output is unchanged; harnesses install tracing-subscriber).
R8. If a prompt's assumption contradicts the code you see, STOP, report the
    discrepancy, propose the minimal correction. Do not improvise architecture.
R9. Do not touch: water, colliders, NAADF render/ graph nodes (except where a ticket
    says), mc_transvoxel, props, editor.
```

## 2. Target workspace layout (end state)

```text
Cargo.toml                      # [workspace] + existing root package
crates/
  clod-core/
    Cargo.toml                  # glam, serde, serde_yaml, tracing; meshopt+bytemuck behind feature "simplify" (default)
    clod_pages.yaml             # moved from config/ — single source of truth
    src/{lib,types,weld,lock,validate,source_mesh,quadtree,simplify,config}.rs
    tests/golden/               # fixtures moved from tools/clod-rs
  naadf-core/
    Cargo.toml                  # glam, wgpu, bytemuck, tracing; feature "compose" -> naga_oil
    shaders/*.wgsl              # moved from assets/shaders/naadf (canonical copy)
    src/lib.rs
    src/data/{layout,cache,dirty,stats,streaming}.rs
    src/build/{cpu_builder,cpu_trace,gpu_buffers}.rs
    src/shaders.rs              # include_str! consts + (virtual_path, source) manifest + compose()
src/voxel/pages/                # thin engine adapter: export.rs, runtime.rs, plugin.rs, tests.rs
src/rendering/naadf/            # engine shell: extractor, prepare, render/, newtype Resources
tools/clod-rs/                  # thin: depends on clod-core; keeps terrain.rs + spike bin
tools/naadf-playground/         # Sprint 3: native winit+wgpu+egui skeleton
scripts/check-core-portability.(sh|ps1)
```

---

# Sprint 1 — Workspace + clod-core (proves the pattern on the small system)

Order: CORE-1 → CORE-2 → CORE-3 → CORE-4 → CORE-5. Est. 4–6 ideal days total.

---

## CORE-1 — Convert repo to a cargo workspace

**Requirements**
- Root `Cargo.toml` gains `[workspace]` with members `[".", "tools/clod-rs"]` (crates/ added by later tickets).
- Shared `[workspace.dependencies]` for: glam, bytemuck, serde, serde_yaml, meshopt, wgpu, tracing.
- Engine builds and tests exactly as before; tools/clod-rs builds as a member.

Depends: none. Est: 0.5d.
Acceptance: `cargo build` (root bin unchanged), `cargo test --workspace` green, `cargo metadata` lists both members, no dependency version changed.

**Prompt**
```text
Context: repo is a single package "voxel_builder" (edition 2024) plus an orphan package
tools/clod-rs (edition 2021). Goal: one cargo workspace, zero behavior change. F9: if
sccache is missing, prefix builds with RUSTC_WRAPPER="".

Steps:
1. In root Cargo.toml, append:
   [workspace]
   members = [".", "tools/clod-rs"]
   resolver = "3"
   [workspace.dependencies]
   glam = "<the version bevy 0.18.1 re-exports — read it from Cargo.lock, do not guess>"
   bytemuck = { version = "1.20", features = ["derive"] }
   serde = { version = "1.0", features = ["derive"] }
   serde_yaml = "0.9"
   meshopt = "0.6"
   wgpu = "<version from Cargo.lock that bevy 0.18.1 uses>"
   tracing = "0.1"
2. Do NOT change any [dependencies] entries to workspace = true yet, except in
   tools/clod-rs where you may switch meshopt/bytemuck/serde/serde_yaml to
   { workspace = true } to prove the mechanism.
3. tools/clod-rs edition stays 2021 (no edition migration in this ticket).
4. Check .cargo/config.toml interacts fine with the workspace (it does not need edits).

Must not: bump any dependency version; touch src/; touch tools/clod-poc.
Verify: cargo metadata --no-deps | grep -c '"name"'  -> 2 packages;
        cargo build; cargo test --workspace; cargo clippy --workspace -- -D warnings.
Done when: acceptance passes and the diff touches only the two Cargo.toml files (+lock).
```

---

## CORE-2 — Reconcile the diverged weld.rs (and any other clod-rs drift) BEFORE extraction

**Requirements**
- Produce a written diff report `docs/plans/clod-core-drift-report.md` for every file pair tools/clod-rs/src/X.rs vs src/voxel/pages/X.rs.
- Engine version is canonical; port into the engine any sandbox-only fix that is a real improvement (justify each), discard the rest.
- After this ticket, the engine files are the single semantic truth that CORE-3 moves.

Depends: CORE-1. Est: 0.5–1d.
Acceptance: report committed; engine `cargo test` green; clod-rs left untouched (it dies in CORE-5).

**Prompt**
```text
Context: src/voxel/pages/* was ported from tools/clod-rs and has since improved
(hard-fail weld conflicts, byte attribute stride). tools/clod-rs/src/weld.rs already
differs. We must not extract a stale or forked truth.

Steps:
1. For each shared module (types, weld, lock, validate, source_mesh, quadtree,
   simplify, config): diff -u tools/clod-rs/src/X.rs src/voxel/pages/X.rs.
2. Classify every hunk: (a) engine improvement — keep engine; (b) sandbox-only fix
   absent in engine — port to engine with a unit test; (c) cosmetic — ignore.
3. Write docs/plans/clod-core-drift-report.md: table of file -> hunks -> classification
   -> action. Keep it short and factual.
4. Apply only class (b) ports to src/voxel/pages/, each with a test.

Must not: edit tools/clod-rs (CORE-5 retires it); reformat whole files (minimal diffs).
Verify: cargo test --workspace; report exists and matches the applied changes.
Done when: a reviewer can read the report and trust src/voxel/pages/* as canonical.
```

---

## CORE-3 — Create crates/clod-core (move the pure builder)

**Requirements**
- New crate `crates/clod-core`: types, weld, lock, validate, source_mesh, quadtree, config moved verbatim from src/voxel/pages; simplify behind default feature `simplify` (meshopt, bytemuck optional deps).
- Bevy decoupling: glam math directly; `TerrainMainSurfaceExport` loses `chunk_pos: IVec3 + lod: LodLevel + world_origin()` lookup — gains `world_origin: [f32; 3]` and `chunk_key: [i32; 3]` (diagnostics only). LOD0 enforcement moves to the engine adapter (CORE-4).
- `config/clod_pages.yaml` moves to `crates/clod-core/clod_pages.yaml`; core embeds it via include_str!.
- All pure unit tests move with their modules.

Depends: CORE-2. Est: 1–1.5d.
Acceptance: `cargo test -p clod-core` green (incl. meshopt reduction test); `cargo check -p clod-core --no-default-features` compiles WITHOUT meshopt/cc; engine still compiles (temporarily via path re-exports added in this ticket or compile broken is NOT acceptable — do the minimal `pub use clod_core::...` shims in src/voxel/pages/mod.rs here, full adapter cleanup is CORE-4).

**Prompt**
```text
Context: src/voxel/pages contains near-pure builder modules (F3) plus engine-coupled
export.rs/runtime.rs/plugin.rs. Extract the pure part into crates/clod-core with zero
behavior change. R6: no bevy deps, no runtime file IO.

Steps:
1. cargo new --lib crates/clod-core (edition 2024). Cargo.toml:
   [features] default = ["simplify"]; simplify = ["dep:meshopt", "dep:bytemuck"]
   [dependencies] glam/serde/serde_yaml/tracing = { workspace = true }
   meshopt/bytemuck = { workspace = true, optional = true }
   Add "crates/clod-core" to [workspace] members.
2. git mv the module bodies of src/voxel/pages/{types,weld,lock,validate,source_mesh,
   quadtree,config}.rs into crates/clod-core/src/ and wire lib.rs with the module-level
   invariants doc comment currently in src/voxel/pages/mod.rs (move it).
3. simplify.rs moves too but is #[cfg(feature = "simplify")] gated in lib.rs; its
   SimplifyOutput/ClodBuildError::MeshoptFailed stay available unconditionally
   (move those items into types.rs if needed so non-simplify builds still typecheck).
4. Replace bevy math: IVec3/Vec3 -> glam::{IVec3, Vec3}. Replace any bevy log macro
   with tracing::{info, warn, error}.
5. Decouple TerrainMainSurfaceExport — this struct currently lives in engine export.rs;
   define the CORE version here in types.rs:
     pub struct TerrainMainSurfaceExport {
         pub local_positions: Vec<[f32; 3]>,
         pub normals: Vec<[f32; 3]>,
         pub material_weights: Vec<[f32; 4]>,
         pub indices: Vec<u32>,
         pub world_origin: [f32; 3],   // engine computes chunk_to_world
         pub chunk_key: [i32; 3],      // diagnostics only
         pub revision: u64,
     }
   source_mesh.rs: concat_exports uses e.world_origin directly; DELETE the LodLevel
   check from build_lod0_page_source (engine enforces in CORE-4) and note that in the
   doc comment. Everything else verbatim.
6. Move config/clod_pages.yaml -> crates/clod-core/clod_pages.yaml; config.rs
   include_str! path updates accordingly. grep -rn "config/clod_pages.yaml" across the
   repo (engine code, tools/clod-poc, docs/plans/*) and update every reference: code
   must point at the new path; docs get the new path mentioned.
7. Move the pure unit tests (weld merge/conflict, simplify reduction grid) into the
   respective core modules; the in-engine FFI link test stays in src/voxel/pages/tests.rs.
8. Temporary shims so the engine keeps compiling this ticket: src/voxel/pages/mod.rs
   gains `pub use clod_core::{...}` for every moved item, and src/voxel/pages keeps
   export.rs/runtime.rs/plugin.rs/tests.rs compiling against the core types — adjust
   export.rs to construct the new core struct (compute world_origin via
   VoxelWorld::chunk_to_world here; keep the LOD0 assert here for now).
   Add `clod-core = { path = "crates/clod-core" }` to root [dependencies].

Must not: change weld/lock/validate/quadtree logic; rename public functions; leave any
duplicate module body in src/voxel/pages.
Verify: cargo test -p clod-core;
        cargo check -p clod-core --no-default-features;
        cargo test --workspace;
        grep -rn "use bevy" crates/clod-core/  -> zero hits.
Done when: all four verifies pass and src/voxel/pages contains only mod.rs (shims),
export.rs, runtime.rs, plugin.rs, tests.rs.
```

---

## CORE-4 — Engine adapter cleanup (src/voxel/pages becomes a thin shell)

**Requirements**
- `export.rs` is the only producer of `clod_core::TerrainMainSurfaceExport`; it enforces LOD0 (hard error `ClodExportError`-style, not assert) and fills world_origin/chunk_key/revision.
- `mod.rs` shims reduced to intentional re-exports with a doc comment pointing at clod-core.
- runtime.rs/plugin.rs compile against core types; behavior identical (default-off, Alt+F11, env vars).

Depends: CORE-3. Est: 0.5d.
Acceptance: `cargo test --workspace` green; `CLOD_PAGES=1` run logs identical startup line; grep shows no engine file defines builder logic.

**Prompt**
```text
Context: CORE-3 left temporary shims. Finish the adapter so the engine side is only:
MeshData -> core export (with LOD0 enforcement), cache/runtime systems, plugin.

Steps:
1. export.rs: extract_main_surface_for_clod keeps its MeshData/section-tag logic
   (engine-only) but now returns clod_core::TerrainMainSurfaceExport. Add an explicit
   error variant for non-LOD0 input (move the LodLevel check that CORE-3 deleted from
   core into here). world_origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3().
2. mod.rs: keep `pub use clod_core::{ClodBuildError, PageFootprint, PageMesh, ...}` and
   local exports; module doc comment: "builder lives in crates/clod-core — edit there."
3. runtime.rs/plugin.rs: imports updated; zero logic change. Confirm the startup log
   string is byte-identical (bench scripts may grep it).
4. Delete any leftover dead code from the move.
Must not: alter budgets, radii, toggles, or system ordering.
Verify: cargo test --workspace; manual: CLOD_PAGES=1 cargo run --release (or the bench
script) shows the same "CLOD PAGES: source meshing ON ..." line; Alt+F11 toggles.
Done when: src/voxel/pages/*.rs total < ~500 LoC and contains no weld/simplify/quadtree code.
```

---

## CORE-5 — Retire tools/clod-rs into a thin harness on clod-core

**Requirements**
- tools/clod-rs depends on clod-core; its duplicated modules deleted; keeps `terrain.rs` (synthetic world) and the `clod_spike` bin.
- Golden fixtures (serialized stress-page outputs) move to `crates/clod-core/tests/golden/` with a loader test that runs the full build (weld→lock→simplify→quadtree) and matches within epsilon.
- docs/plans updated: clod-execution-plan §6 layout note + Phase 4 "golden tests" pointer now reference clod-core.

Depends: CORE-4. Est: 0.5–1d.
Acceptance: `cargo test -p clod-core` runs golden tests; `cargo run -p clod-rs --bin clod_spike` still produces its report; no module body exists in three places anywhere.

**Prompt**
```text
Context: tools/clod-rs was the Phase-4 sandbox and is now a divergent copy (F2). It
becomes a thin consumer of clod-core, preserving the synthetic-terrain spike.

Steps:
1. tools/clod-rs/Cargo.toml: add clod-core = { path = "../../crates/clod-core" };
   drop meshopt/bytemuck direct deps if now unused.
2. Delete tools/clod-rs/src/{types,weld,lock,validate,source_mesh,quadtree,simplify,
   config}.rs; lib.rs re-exports clod_core + keeps terrain.rs. Fix spike.rs imports.
3. Locate the golden fixtures/outputs the Phase-4 gate used (search tools/clod-rs for
   serialized expected data or the code that wrote/compared it). Move fixtures to
   crates/clod-core/tests/golden/ and write tests/golden.rs: load fixture -> run the
   pipeline with the embedded config -> compare positions/indices/error_world within
   the epsilons the sandbox used. If fixtures were never committed, regenerate them
   ONCE with the current pipeline, commit, and note that in the test header.
4. Update docs/plans/clod-execution-plan.md (§6 crate layout) and
   docs/plans/clod-phase5-plan.md (D2 note) to reference crates/clod-core.
Must not: change spike behavior; invent new fixture formats if one exists.
Verify: cargo test -p clod-core (golden included); cargo run -p clod-rs --bin clod_spike;
        grep -rn "fn weld_vertices" --include=*.rs | wc -l  -> exactly 1.
Done when: one weld/one simplify/one quadtree implementation exists in the repo.
```

---

# Sprint 2 — naadf-core (CPU side: data + build)

Order: CORE-6 → CORE-7 → CORE-8. Est. 4–6 ideal days.

---

## CORE-6 — Create crates/naadf-core: data/ + cpu_builder/cpu_trace (no GPU yet)

**Requirements**
- New crate `crates/naadf-core` with `src/data/{layout,cache,dirty,stats,streaming}.rs` and `src/build/{cpu_builder,cpu_trace}.rs` moved from src/rendering/naadf.
- Decoupling: bevy::prelude → glam + tracing; `FrameCount` → explicit `frame: u64` parameters threaded through every function/struct that used it; `Resource` derives removed (engine wraps in CORE-8).
- No bevy anywhere in the crate; unit tests move along.

Depends: CORE-1 (not on Sprint 1 completion, but run after it to reuse the pattern). Est: 1.5–2d.
Acceptance: `cargo test -p naadf-core` green; `grep -rn "use bevy" crates/naadf-core` → 0; engine compiles via temporary shims (same technique as CORE-3 step 8).

**Prompt**
```text
Context: F5 — NAADF data/+build/ have shallow Bevy coupling: prelude (glam+log),
FrameCount, and Resource derives. extractor.rs and prepare.rs are render-world coupled
and STAY in the engine. gpu_buffers.rs is CORE-7, do not move it here.

Steps:
1. cargo new --lib crates/naadf-core (edition 2024); deps: glam, bytemuck, tracing
   (workspace); add to workspace members. Root Cargo.toml gains
   naadf-core = { path = "crates/naadf-core" } gated nothing (the engine `naadf`
   feature keeps gating engine-side modules only).
2. git mv src/rendering/naadf/data/{layout,cache,dirty,stats,streaming}.rs and
   src/rendering/naadf/build/{cpu_builder,cpu_trace}.rs into the crate, preserving
   module structure (src/data/..., src/build/...). lib.rs declares them and carries a
   doc comment: "derived voxel ray cache core — no Bevy, no engine types".
3. Mechanical decoupling, file by file:
   - use bevy::prelude::* -> use glam::{IVec3, UVec3, Vec3, ...} (only what's used)
     and tracing::{info, warn, error, debug} for log macros.
   - bevy::diagnostic::FrameCount -> change every function/struct field that read
     frame_count.0 to take/store frame: u64. Update call signatures; the engine passes
     FrameCount.0 at the boundary (CORE-8). Keep a grep list of changed signatures in
     the commit message.
   - #[derive(Resource)] -> delete; leave a // engine wraps in newtype (CORE-8) note.
   - If any moved file imports extractor/prepare or other engine modules, STOP per R8
     and report — the cut line may need adjusting (acceptable fallback: leave that one
     file engine-side and document why in the commit).
4. Move the unit tests living in these files; tests needing VoxelWorld/Bevy stay
   engine-side (relocate them into src/rendering/naadf/ tests temporarily).
5. Temporary shims: src/rendering/naadf/{data,build}/mod.rs re-export naadf_core items
   so the rest of the engine compiles unchanged this ticket.
Must not: touch render/, extractor.rs, prepare.rs, gpu_buffers.rs, any WGSL; change
any algorithm; reorder fields of pod/bytemuck structs (layout.rs is GPU-layout
sensitive — byte-identical structs required).
Verify: cargo test -p naadf-core; cargo test --workspace;
        grep -rn "use bevy" crates/naadf-core -> 0;
        grep -rn "FrameCount" crates/naadf-core -> 0.
Done when: crate builds standalone and the engine builds via shims with zero behavior change.
```

---

## CORE-7 — Port gpu_buffers.rs to raw wgpu inside naadf-core

**Requirements**
- `gpu_buffers.rs` moves to `crates/naadf-core/src/build/gpu_buffers.rs`; bevy `render_resource::{Buffer, BufferDescriptor, BufferUsages}` and `RenderDevice/RenderQueue` replaced with `wgpu::{Buffer, BufferDescriptor, BufferUsages, Device, Queue}`.
- Public functions take `&wgpu::Device` / `&wgpu::Queue` explicitly; readback (map_async/poll) logic preserved exactly.
- `wgpu` becomes a naadf-core dependency pinned to the version Bevy 0.18.1 uses (Cargo.lock, F1) — a mismatched wgpu major will not interop with the engine's device.

Depends: CORE-6. Est: 1d.
Acceptance: `cargo test -p naadf-core` (including any moved gpu_tests that can run headless — if they need an adapter, gate with an env var like the existing gpu_tests do); engine compiles; in-engine `naadf` gpu_tests pass.

**Prompt**
```text
Context: gpu_buffers.rs already mixes bevy render_resource wrappers with raw wgpu calls
(F5). Bevy's RenderDevice/Buffer are thin wrappers over wgpu; the engine can hand the
underlying wgpu device into core APIs (RenderDevice::wgpu_device(), Buffer derefs /
exposes the wgpu::Buffer — verify exact accessor names in bevy 0.18.1 source, R8 if absent).

Steps:
1. Add wgpu = { workspace = true } to naadf-core (CORE-1 pinned it from Cargo.lock).
2. git mv src/rendering/naadf/build/gpu_buffers.rs -> crates/naadf-core/src/build/.
3. Type swap: bevy Buffer/BufferDescriptor/BufferUsages -> wgpu equivalents;
   RenderDevice -> &wgpu::Device; RenderQueue -> &wgpu::Queue. FrameCount per CORE-6.
   Function-by-function: signatures change, bodies stay logically identical.
4. Engine boundary: every caller (prepare.rs, gpu_tests.rs, render/ pipeline code)
   passes render_device.wgpu_device() / queue.0 (or the 0.18.1 accessor) and wraps any
   returned wgpu::Buffer where bevy types are required downstream. Keep this glue in
   the engine files — naadf-core never imports bevy (R6).
5. Move what's movable from gpu_tests.rs into naadf-core (tests that only need a wgpu
   instance/adapter, created headless via wgpu::Instance with backends=all and skipped
   when no adapter, mirroring the existing test gating). Engine-coupled GPU tests stay.
Must not: change buffer sizes, usages, labels, or the readback sequencing; upgrade wgpu.
Verify: cargo test -p naadf-core; cargo test --workspace;
        run the in-engine naadf gpu test suite the same way CI/bench does today.
Done when: core owns all NAADF buffer creation/readback and the engine only adapts device/queue.
```

---

## CORE-8 — Engine shell rewiring (newtype Resources, FrameCount boundary, shim removal)

**Requirements**
- All temporary shims from CORE-6 removed; `src/rendering/naadf/{data,build}` directories contain only extractor.rs, prepare.rs, engine-only tests, and newtype `Resource` wrappers (e.g. `#[derive(Resource)] pub struct NaadfCacheRes(pub naadf_core::data::cache::Cache);`).
- Every system reading `FrameCount` passes `frame_count.0` into core calls.
- Default-off behavior, env toggles, bench log lines: byte-identical.

Depends: CORE-7. Est: 1d.
Acceptance: `cargo test --workspace` green incl. naadf tests; a manual NAADF preview run (split-view) is visually identical to a pre-refactor screenshot; `grep -rn "naadf_core" src/rendering/naadf/render` shows render/ consuming core types only through the shell.

**Prompt**
```text
Context: finish the NAADF extraction. The engine keeps: ECS systems, extract/prepare,
render graph, Resources. Core keeps: layout/cache/dirty/stats/streaming/cpu_builder/
cpu_trace/gpu_buffers.

Steps:
1. Delete the CORE-6 re-export shims; update every import across src/rendering/naadf
   and any other engine module to naadf_core::... paths.
2. Create newtype wrappers for each former Resource type, in a new
   src/rendering/naadf/resources.rs, with Deref/DerefMut impls to keep call-site diffs
   minimal. Register them where the originals were registered.
3. Thread FrameCount: systems take Res<FrameCount> and pass .0 — audit with
   grep -rn "FrameCount" src/rendering/naadf and fix every site.
4. Re-run the full verification battery; take the before/after preview screenshot
   (NAADF preview split-view mode) and attach paths in the commit message.
Must not: alter system ordering, schedules, or the naadf feature gating semantics.
Verify: cargo test --workspace; clippy -D warnings; manual preview A/B; bench script
        startup logs diff-clean against a pre-Sprint-2 run.
Done when: src/rendering/naadf compiles with zero local copies of moved logic and the
preview A/B shows no difference.
```

---

# Sprint 3 — Shaders, portability proof, playground skeleton

Order: CORE-9 → CORE-10 → CORE-12 → CORE-11. Est. 4–5 ideal days.

---

## CORE-9 — WGSL moves to naadf-core; engine consumes via build-time copy (Plan A)

**Requirements**
- Canonical WGSL lives in `crates/naadf-core/shaders/`; `naadf_core::shaders` exposes `include_str!` consts plus a manifest `pub const ALL: &[(&str, &str)]` of (virtual asset path `"shaders/naadf/x.wgsl"`, source).
- Engine keeps loading shaders exactly as today via a **build-time copy**: root `build.rs` copies `crates/naadf-core/shaders/*.wgsl` into `assets/shaders/naadf/` (which becomes gitignored, with a README stub explaining it is generated). Asset paths and `#import` keys (F6) are therefore untouched — zero Bevy asset-system surgery.
- Stretch (separate follow-up, not this ticket): replace the copy with `load_internal_asset`/embedded registration.

Depends: CORE-8. Est: 1d.
Acceptance: clean checkout + `cargo build` produces the copied shaders; NAADF preview renders identically; `git status` clean after build (gitignore correct); deleting one copied file and rebuilding restores it.

**Prompt**
```text
Context: F6 — NAADF WGSL uses naga_oil #import with ASSET-PATH keys like
"shaders/naadf/common.wgsl". Moving files out of assets/ would break Bevy import
resolution, so the engine consumes a build-time copy while the canonical source moves
to the crate. This keeps risk near zero and still gives harnesses the same source.

Steps:
1. git mv assets/shaders/naadf/*.wgsl -> crates/naadf-core/shaders/ (24 files).
2. crates/naadf-core/src/shaders.rs: one include_str! const per file (SCREAMING_SNAKE
   of filename) + pub const ALL: &[(&str, &str)] mapping
   ("shaders/naadf/<file>.wgsl", SOURCE). Unit test: ALL.len() == 24 and every source
   non-empty and every virtual path unique.
3. Root build.rs (create if absent): iterate naadf-core/shaders/*.wgsl, copy to
   assets/shaders/naadf/ when missing or content differs (compare bytes — do not copy
   unconditionally or incremental builds churn). println! cargo:rerun-if-changed for
   the shader dir.
4. .gitignore: add assets/shaders/naadf/ ; commit a assets/shaders/naadf/README.md
   ("generated from crates/naadf-core/shaders — edit there") that is NOT ignored
   (negate pattern).
5. Feature "compose" in naadf-core: optional dep naga_oil pinned to the version in
   Cargo.lock; pub fn compose(entry: &str) -> Result<String/naga Module, Error> that
   registers ALL into a naga_oil Composer and resolves imports — used by the
   playground (CORE-11), never by the engine. Behind the feature so default builds
   skip naga_oil.
Must not: edit any WGSL content; change Bevy shader loading code; leave both copies
tracked in git.
Verify: rm -rf assets/shaders/naadf && cargo build -> files restored; run engine with
NAADF preview -> identical; cargo test -p naadf-core --features compose (a smoke test
composing first_hit.wgsl must succeed).
Done when: canonical shaders live in the crate, the engine is byte-identical at runtime,
and compose() resolves at least first_hit + its imports.
```

---

## CORE-10 — Portability gate: wasm32 + no-default-features checks in a script

**Requirements**
- `scripts/check-core-portability.sh` and `.ps1`: (1) `cargo check -p clod-core --no-default-features --target wasm32-unknown-unknown`; (2) `cargo check -p naadf-core --target wasm32-unknown-unknown`; (3) `grep -rn "std::time::Instant" crates/` must return nothing (use `web-time` re-export if any appear).
- Fix whatever the checks surface (expected: Instant usages, possibly wgpu feature flags for the wasm target).
- Wire into whatever check script/CI the repo already runs (search scripts/ for the existing test runner and append).

Depends: CORE-6 (clod part can run after CORE-3). Est: 0.5–1d.
Acceptance: both scripts pass on a machine with `rustup target add wasm32-unknown-unknown`; documented in docs/plans/clod-execution-plan.md §9 follow-up note.

**Prompt**
```text
Context: wasm32 is a compile target of the core crates, not a product yet. The gate
exists so future work cannot silently re-couple the cores to native-only APIs.
F8: meshopt cannot build for wasm, hence clod-core --no-default-features.

Steps:
1. Write both scripts (bash + PowerShell, repo already ships PowerShell scripts —
   match their style). Steps: rustup target add wasm32-unknown-unknown (idempotent);
   the two cargo checks; the Instant grep (exit 1 on hit with a message naming web-time).
2. Run them. For each failure: std::time::Instant -> web_time::Instant (add web-time
   workspace dep, re-export through a small core util mod so call sites stay clean);
   wgpu wasm target may require features = ["webgpu"] on wasm — express via
   [target.'cfg(target_arch = "wasm32")'.dependencies] in naadf-core, NOT by changing
   the native dependency line.
3. Append the script invocation to the existing repo check/test script.
Must not: introduce wasm-bindgen or any browser glue (that's the future harness's job);
weaken native features to make wasm pass.
Verify: bash scripts/check-core-portability.sh on Linux; pwsh variant parses (syntax
check) even if not run.
Done when: both cores compile for wasm32 and the gate runs with the normal checks.
```

---

## CORE-12 — Engine bake command: serialize NAADF cache to disk for external harnesses

**Requirements**
- Debug-only command (keybind in the existing NAADF debug input map + `NAADF_BAKE=path` env on exit, mirroring existing debug toggles' style) that snapshots the current NAADF cache: layout header + every GPU buffer (via the existing readback path in gpu_buffers) into one file.
- Format defined in naadf-core (`src/data/bake.rs`): magic + version + postcard/bincode of a `BakedCache { layout: ..., buffers: Vec<(name, Vec<u8>)> }`; load function included and unit-tested with a tiny synthetic cache.
- Round-trip test: bake from cpu_builder output (no GPU needed) → load → byte-equal.

Depends: CORE-7. Est: 1d.
Acceptance: in-engine bake of a small test scene writes a loadable file; `cargo test -p naadf-core` covers round-trip; file size logged.

**Prompt**
```text
Context: external harnesses (native playground now, browser later) consume real engine
data instead of reimplementing the builder. The cache layout structs already exist in
naadf-core (layout.rs) and readback exists in gpu_buffers.rs.

Steps:
1. naadf-core src/data/bake.rs: BakedCache struct, save_to_bytes/load_from_bytes with
   magic b"NADF" + u32 version=1, postcard (add workspace dep) for the header, raw
   little-endian blobs for buffers. Unit test: synthetic 2-buffer cache round-trips.
2. naadf-core build/gpu_buffers.rs: pub fn read_back_all(device, queue, <cache buffers>)
   -> Vec<(String, Vec<u8>)> reusing the existing map_async/poll readback helper —
   factor, don't duplicate.
3. Engine: a debug system (feature naadf_debug) bound next to the existing NAADF debug
   keys (find the input map in src/rendering/naadf root files) that calls read_back_all
   + save, default path target/naadf_bake.bin, overridable via NAADF_BAKE env. Log
   path + byte size at info level.
4. CPU-path round-trip test engine-side or core-side: cpu_builder builds a tiny world,
   bake, load, compare.
Must not: run readback every frame; bake on the render thread without the existing
poll pattern; add the keybind outside the naadf_debug feature.
Verify: cargo test -p naadf-core; in-engine: enable NAADF on the bench scene, press the
bake key, confirm file exists and loads via a #[test] or a tiny example bin.
Done when: a .bin baked from the engine loads through naadf_core::data::bake in a test.
```

---

## CORE-11 — tools/naadf-playground skeleton (native winit + wgpu + egui)

**Requirements**
- New workspace member `tools/naadf-playground`: opens a window, loads a `BakedCache` path from argv, uploads buffers, composes (CORE-9 `compose` feature) and dispatches `first_hit.wgsl`, blits the result fullscreen, egui panel with camera + a couple of debug uniforms.
- A `--parity N` mode: trace N random rays via `cpu_trace` against the same baked data and compare with GPU first-hit output (position/ID within tolerance), printing pass/fail — the cross-host correctness anchor.
- This is a skeleton: first_hit + parity only; GI/temporal/denoise explicitly out of scope.

Depends: CORE-9, CORE-12. Est: 1.5–2d.
Acceptance: `cargo run -p naadf-playground -- target/naadf_bake.bin` shows the first-hit image of a baked scene; `--parity 1000` passes; crate compiles with `cargo check -p naadf-playground` on native (wasm build of the playground is future work, not this ticket).

**Prompt**
```text
Context: the playground proves naadf-core is genuinely standalone and gives the fast
iteration loop for lighting work. Keep it minimal (KISS): one pipeline, one panel.

Steps:
1. cargo new tools/naadf-playground (bin, workspace member). Deps: naadf-core
   { path, features = ["compose"] }, wgpu (workspace), winit, egui + egui-wgpu +
   egui-winit (latest compatible with the pinned wgpu — check crates.io compat table;
   if the pinned wgpu is too old for current egui-wgpu, pick the matching older egui
   line and note the pin in Cargo.toml comments), pollster, glam, tracing-subscriber.
2. main.rs: parse argv (bake path, --parity N optional); init tracing-subscriber;
   create wgpu instance/adapter/device/queue; load BakedCache; create buffers/bind
   groups matching the layouts gpu_buffers exposes (reuse its creation fns — that is
   the point); compose first_hit via naadf_core::shaders::compose; compute pipeline;
   per-frame: update camera uniform from egui-controlled state, dispatch, blit storage
   texture to surface.
3. parity.rs: with --parity N, run cpu_trace on N seeded-random rays against the baked
   cache, read back the GPU hit buffer/texture for the same rays (one dispatch writing
   to a small buffer is fine), compare within tolerances (define consts at top, e.g.
   POS_EPS = 1e-3 world units, exact ID match), print a summary table, exit nonzero on
   failure.
4. README.md: how to bake (CORE-12 key), run, and what is intentionally NOT here.
Must not: copy any naadf logic into the playground; add features beyond first_hit +
parity; introduce Three.js/web anything.
Verify: cargo check -p naadf-playground; cargo run -p naadf-playground -- <bake> renders;
--parity 1000 exits 0 on a known-good bake.
Done when: a teammate can bake in-engine and see the same scene's first-hit image in the
playground within one minute, with parity green.
```

---

## 3. Risk register

```text
RK1 (CORE-9, highest): #import asset-path coupling. Mitigated by Plan A build-time
    copy — engine asset loading is untouched. Embedded registration is a separate
    future ticket, attempted only after Plan A is stable.
RK2 (CORE-7): bevy 0.18.1 wgpu accessor names (wgpu_device(), Buffer inner access)
    must be verified in source; R8 stop-and-report if absent.
RK3 (CORE-6): layout.rs structs are GPU-ABI. Any accidental field reorder corrupts
    every shader. Byte-identical move enforced; bytemuck derives unchanged.
RK4 (CORE-3/F7): stray references to config/clod_pages.yaml (clod-poc, docs, scripts)
    after the move. Mitigated by the mandatory repo-wide grep step.
RK5 (CORE-11): egui/wgpu version matrix vs the engine-pinned wgpu. Resolved by pinning
    egui to the compatible line, never by bumping wgpu.
RK6 (process): partial extraction abandoned mid-sprint leaves three truths. Sprints
    are ordered so every ticket ends in a fully-consistent state; do not start
    Sprint 2 with Sprint 1 tickets open.
```

## 4. Definition of done (program level)

```text
D1. grep -rn "use bevy" crates/ -> 0.
D2. Exactly one implementation of weld/simplify/quadtree and of NAADF
    layout/cpu_builder/cpu_trace/gpu_buffers in the repo.
D3. cargo test --workspace green; clippy -D warnings clean; portability script green.
D4. Engine behavior byte-identical: bench startup logs, NAADF preview A/B screenshot,
    CLOD A/B toggle all unchanged.
D5. Playground renders a baked scene's first hit with cpu_trace parity passing.
```
