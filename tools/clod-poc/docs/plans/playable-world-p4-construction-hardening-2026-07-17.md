# Playable-world P4 construction hardening

Created 2026-07-17.

## Scope

This change completes P4 of `playable-world-contract-2026-07-16.md` on top of the merged construction terrain-transaction runtime.

The runtime contract is:

```text
terrain support disappears
  -> re-probe affected construction
  -> recompute the connected stability island
  -> mark unsupported pieces visibly
  -> keep their visible geometry and collision aligned
  -> persist the semantic support state
```

Unsupported construction is not deleted automatically. Structural collapse needs its own visible motion, physics, damage, and persistence contract and remains deferred.

Explicit player deletion remains atomic within the synchronous construction store transaction:

- support graph node and connection metadata;
- visible mesh;
- collision proxy;
- snap points;
- overlap index;
- persisted placement entry.

Foundation terrain transactions remain owned by the merged construction Phase 4 path. This hardening does not bypass its preview, commit, compensation, receipt, or undo rules.

## Acceptance coverage

`src/construction/playable_world_p4_construction.test.ts` gates:

1. Digging support from below a structure marks the connected island unsupported while preserving every visible mesh and collider.
2. Removing a piece clears visual, collider, snap, overlap, graph, connection, and persisted state together.
3. Thirty pieces round-trip by semantic state, not serialized byte order.
4. A construction commit remains singular while a terrain collider page replacement is pending at the placement boundary.

`src/construction/construction_stability_runtime.test.ts` locks the owner decision that unsupported pieces remain present and are not queued for destructive collapse.

## Verification

Run from native Windows PowerShell:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/construction/construction_stability_runtime.test.ts src/construction/construction_piece_store.test.ts src/construction/construction_piece_store_phase2.test.ts src/construction/construction_hardening.test.ts src/construction/playable_world_p4_construction.test.ts
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run perf:construction
npm --prefix tools/clod-poc run world:verify
```
