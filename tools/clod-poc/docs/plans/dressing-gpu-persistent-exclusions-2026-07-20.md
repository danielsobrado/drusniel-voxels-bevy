# GPU Dressing Persistent Exclusions

Status: implementation complete on branch; native verification pending.

## Scope

This slice closes one known ecological-dressing authority gap: persistent environmental dressing marked `destroyed` or `harvested` must not regenerate in the WebGPU candidate kernel.

It does not change the save database schema. The existing save environmental-prop address uses tile/layer/candidate coordinates, while ecological dressing uses the canonical two-word stable ID. A later schema migration must persist `EnvironmentalPropDelta` directly rather than translate between incompatible identities.

## Fixed implementation

- `DressingPersistenceBridge` publishes a monotonic revision and sorted two-word exclusion snapshot.
- The GPU table stores `vec4<u32>(lo, hi, occupied, 0)`.
- Capacity is the next power of two at no more than 50% load.
- CPU and WGSL use the same rotate/xor/mix hash and linear probing.
- Persistent parents are rejected before acceptance and before stump/attachment generation.
- Paired stump IDs are checked independently.
- Table buffers are replaced only when the persistence revision changes.
- No GPU readback is introduced.
- If the required table exceeds `maxStorageBufferBindingSize`, the persistent candidate range is set empty. Terrain-attached cosmetic generation continues; persistent dressing fails closed.

## Required native verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/persistence_bridge_revision.test.ts `
  src/ecology/dressing/gpu/persistent_exclusion_table.test.ts `
  src/ecology/dressing/gpu/persistent_exclusion_gpu_contract.test.ts `
  src/ecology/dressing/gpu/dressing_shader.test.ts `
  src/ecology/dressing/gpu/runtime_contract.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed WebGPU evidence:

1. Start `infinite-islands` with `dressing=1&dressingGpu=1&hud=1`.
2. Record a visible persistent dressing stable ID.
3. Record a `destroyed` delta through `dressingPersistenceBridge`.
4. Keep the camera stationary and verify the exclusion revision triggers a dispatch without waiting for camera movement.
5. Verify the target parent disappears and no paired stump or parent attachment remains.
6. Move outside the active radius and return; verify it does not regenerate.
7. Assert:
   - `dressing_gpu_authority = 1`;
   - `dressing_gpu_readbacks = 0`;
   - `dressing_persistent_exclusion_gpu_active = 1`;
   - exclusion count and revision match the bridge;
   - `dressing_persistent_exclusion_overflow = 0`;
   - WebGPU uncaptured errors remain zero.

## Follow-up boundary

The next persistence PR must add a versioned `EnvironmentalPropDelta` save record, migration, region partitioning, load restore, dirty-region write path, and CPU fallback consumption. It must not encode dressing stable IDs as the existing tile/layer/candidate environmental prop address.
