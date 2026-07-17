# Playable-world P6 spell-to-world convergence

Created 2026-07-17.

## Scope

P6 makes one existing terrain-affecting spell authoritative end to end. The earth spell is the reference implementation.

The spell system does not own terrain. It creates an immutable edit command and submits it to the same terrain edit service used by the dig tool and construction terrain conformance.

## Cast lifecycle

```text
input/menu cast
  -> capture terrain target and terrain revision
  -> create immutable non-replayable spell_cast command
  -> wait for real spell pipeline warmup readiness
  -> validate expiry, mode, range, revision and target readiness
  -> build and apply the canonical voxel transaction
  -> start earth impact VFX against the captured target
  -> rebuild LOD0 and near-field terrain
  -> enqueue geometry and collider replacement through the normal CLOD apply path
  -> invalidate streamed roots
  -> publish one spell terrain dirty event
  -> refresh vegetation masks
  -> flush edited ancestors
  -> wait for geometry, collider-apply and async collider-build queues
  -> publish convergence counters and result
```

A denied cast is not queued for later replay. The player must cast again after readiness, mode, range or terrain revision changes.

## Authority rules

- `spell_cast` uses the existing `EditCommand` contract.
- Terrain revision equality is strict because spell casts are not replayable operations.
- The target must be edit-ready at execution time.
- Range is bounded by player terrain-edit authority.
- Protected terrain is rejected.
- The voxel transaction is produced by `voxelTransactionFromDigEdit` and applied by `applyDigEditTransaction`.
- Worker rebuild failure rolls back the authoritative transaction.
- Earth VFX is visual feedback and never mutates terrain directly.

## Warmup correction

The existing warmup exposed a `ready` promise, but spell startup did not pass it to `createDeferredSpellController`. P6 wires that promise into all deferred spell casts. The earth world cast also waits for the same readiness promise before entering terrain authority.

## Configuration

`config/spells.yaml` owns earth terrain-effect tuning:

- enabled state;
- add/remove operation;
- brush shape;
- radius and height;
- strength and falloff;
- material for add operations;
- maximum targeting range;
- command expiry;
- runtime convergence timeout.

No gameplay constants are hidden in the VFX implementation.

## Convergence result

`TerrainSpellEditResult` reports:

- whether authority committed;
- whether voxel state changed;
- whether the tracked derived work converged;
- rejection or failure reason;
- committed terrain revision.

The runtime coordinator additionally waits until the CLOD geometry queue, CLOD collider queue and terrain collider rebuild pipeline are empty. A bounded timeout returns `converged: false` instead of claiming completion while stale collision is still pending.

Runtime counters:

- `spell_world_casts_accepted`
- `spell_world_casts_denied`
- `spell_world_casts_denied_<reason>`
- `spell_world_edits_committed`
- `spell_world_convergence_completed`
- `spell_world_convergence_failed`
- `spell_world_last_converged_revision`
- `spell_world_runtime_convergence_completed`
- `spell_world_runtime_convergence_failed`
- `spell_world_runtime_last_converged_revision`

## Acceptance coverage

- command target, normal, mode and source revision are captured immutably;
- pipeline warmup resolves before authority is called;
- denied authority never starts VFX;
- stale terrain revisions deny without replay or mutation;
- a real earth edit reaches voxel storage, worker rebuild, near-field application, CLOD apply queue, streamed-root invalidation, dirty publication, vegetation refresh and ancestor flush;
- runtime completion waits for geometry and collider queues;
- queue timeout produces a failed convergence result;
- dirty publication identifies the source as `spell` and declares collision and vegetation impact.

## Deliberate boundaries

- Only the earth spell mutates terrain in this phase.
- Fire, water, air, lightning and fireball remain visual/combat effects.
- Spell damage, mana, cooldown design and network replication are outside this contract.
- P7 owns the continuous public-input vertical-slice gate.

## Verification

Run from native Windows PowerShell:

```powershell
npm --prefix tools/clod-poc run typecheck

npm --prefix tools/clod-poc test -- `
  src/spells/deferred_spell_controller.test.ts `
  src/spells/earth_spell_gameplay_config.test.ts `
  src/spells/spell_world_convergence.test.ts `
  src/terrain/editing/spell_world_convergence_service.test.ts `
  src/spells/earth_spell_vfx.test.ts `
  src/spells/spell_vfx_controller.test.ts `
  src/player/edit_commands.test.ts

npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run spells:verify
npm --prefix tools/clod-poc run world:verify
```
