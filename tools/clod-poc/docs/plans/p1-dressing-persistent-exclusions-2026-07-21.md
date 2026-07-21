# P1 dressing persistent exclusions — 2026-07-21

## Scope

Close the persistence gap left by the GPU dressing authority: destroyed persistent dressing candidates must remain absent after save/load and must be rejected before paired stumps or parent attachments are emitted.

## Implementation

- Persistent dressing destruction is stored through the existing `SavedPropStore` and save runtime.
- Save IDs retain the full canonical 64-bit dressing identity as `dressing:<16 hex digits>`.
- Destroyed records carry their class and position as normal saved prop data; no second save database or schema is introduced.
- The runtime derives a sorted `vec2<u32>` exclusion table from restored saved props.
- The table has a dressing-only revision, so unrelated project-prop edits do not cause GPU uploads.
- WebGPU uploads the table to binding 15 only when the exclusion revision changes.
- The compute shader performs an unsigned 64-bit binary search before environmental sampling and before any stump or attachment emission.
- The WebGL/CPU fallback uses the same restored saved records through a small position index.
- No GPU readback is added.

## Public interaction API

```ts
destroyPersistentDressing({ stableId, classId, position });
restorePersistentDressing(stableId, position);
```

Both functions use the normal save runtime dirty-region and autosave path.

## Diagnostics

```text
dressing_persistent_exclusion_count
dressing_persistent_exclusion_revision
dressing_persistent_exclusion_gpu_authority
```

## Verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/saved_exclusions.test.ts `
  src/ecology/dressing/gpu/dressing_shader.test.ts `
  src/ecology/dressing/gpu/runtime_contract.test.ts
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed acceptance should destroy a visible persistent log, flush the save, reload the world, and confirm that the parent log, paired stump, and all parent attachments remain absent with zero dressing readbacks.
