# Glacial Valley dressing grass-contact field — 2026-07-21

## Goal

Publish one GPU-resident contact field from accepted ecological-dressing instances so grass and terrain can later suppress, flatten, and blend around logs, stumps, talus, cobbles, wet stones, and driftwood without CPU proximity scans or GPU readbacks.

This closes the producer half of ecological-dressing Stage 7:

```text
accepted dressing
  -> grass exclusion and blending
```

The consumer is intentionally a separate PR.

## Authority

```text
canonical dressing candidate generation
  -> environmental acceptance
  -> one accepted record in one class/LOD indirect group
  -> post-compaction contact raster pass
  -> shared uint contact field
```

Rejected candidates never enter the field. A visible instance exists in exactly one LOD group, so it is rasterized once.

## Configuration

Production policy is owned by:

```text
config/dressing_grass_contact.yaml
```

The initial policy includes only classes with a physical ground footprint:

- dead logs;
- stumps;
- broken snags;
- large and small driftwood;
- large and small talus;
- river cobbles;
- wet-stone clusters.

Litter, fungi, moss, lichen, vines, ferns, and flowers do not suppress grass in this slice.

Each class defines:

```text
radius_m
strength
```

Radius is multiplied by the accepted instance scale. Strength is packed to `0..65535`.

## Field topology

```text
192 x 192 cells
1 metre per cell
36,864 uint cells
147,456 bytes
```

The field is camera-centered on the same dressing refresh center. It covers the near 96 m radius where contact blending is visually relevant.

## GPU lifecycle

The producer owns two compute pipelines:

1. `clear_field`;
2. `rasterize_records`.

The raster pass reads:

- the existing dressing record buffer;
- existing indirect instance counts;
- one immutable class-policy buffer.

It writes one shared atomic uint field using `atomicMax`.

Submission order is fixed:

```text
dressing generation submit
  -> contact-field submit
  -> normal render submits
```

Both compute submissions use the same device queue. The contact pass therefore observes the accepted records generated immediately before it without a CPU synchronization point.

## Failure policy

The contact producer is a visual derivative, not placement authority.

If creation, encoding, or submission fails:

- emit one deduplicated `console.error`;
- disable and unregister the contact field;
- preserve normal ecological-dressing rendering;
- do not switch placement authority;
- do not crash the frame loop;
- do not read data back to diagnose the failure.

## Diagnostics

```text
dressing_grass_contact_active
dressing_grass_contact_revision
dressing_grass_contact_dispatches
dressing_grass_contact_field_cells
dressing_grass_contact_submit_cpu_ms
dressing_grass_contact_readbacks
dressing_grass_contact_failed
```

`dressing_grass_contact_readbacks` must remain zero.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/gpu/dressing_grass_contact_config.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_compute.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_field.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_system_contract.test.ts `
  src/ecology/dressing/gpu/dressing_shader.test.ts `
  src/ecology/dressing/gpu/runtime_contract.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Dawn must compile both new compute entry points with atomic storage access.

## Headed producer acceptance

Use `scene=infinite-islands`, WebGPU, `dressing=1`, and `dressingGpu=1`.

Capture deterministic poses containing:

- deadfall and paired stumps;
- large talus;
- shallow-river cobbles;
- wet shoreline stones;
- driftwood;
- an area containing only litter and ferns.

Verify through diagnostics and a temporary field debug view:

- only accepted physical classes write contact;
- rejected candidates produce no contact;
- one instance does not duplicate across LOD groups;
- the field follows dressing refreshes and remains world aligned;
- disabled configuration clears and unregisters the field;
- runtime producer failure leaves dressing visible;
- `dressing_grass_contact_readbacks = 0`;
- contact submit CPU p95 remains `<= 0.10 ms`;
- dressing plus contact GPU delta remains `<= 0.20 ms p95`.

## Scope boundary

This PR publishes data only. It does not yet:

- alter grass height, density, colour, or placement;
- tint terrain;
- modify the large grass compute shader;
- compact rejected grass candidates earlier;
- add directional splay around logs;
- add collision or gameplay semantics;
- change ecological-dressing records, identities, placement, LOD, or persistence.

The next stacked PR combines this field with the existing grass-contact material and terrain-tint policy. Compute-side early grass rejection should only follow after profiling proves the extra generated blades are a material cost.
