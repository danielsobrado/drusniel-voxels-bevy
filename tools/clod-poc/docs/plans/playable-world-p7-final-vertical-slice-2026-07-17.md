# Playable-world P7 final vertical slice

Created 2026-07-17.

## Scope

P7 is the release gate for the P0–P6 playable-world contract. It does not add another terrain, construction, water, spell, or persistence subsystem. It proves that the existing systems work together through the same public actions used by a player.

The sparse `continent` route is the required gate. The same runner can be extended to a dense RPG scene after a dense scene with a deterministic river approach is designated.

## Required sequence

Each run performs this order:

```text
spawn on dry authoritative terrain
  -> sprint across a terrain page boundary
  -> dig through the normal pointer route
  -> enter build mode immediately after the edit commits
  -> place one construction piece
  -> break/delete that piece
  -> continue into canonical river water
  -> enter surface or submerged swim locomotion
  -> cast the earth spell
  -> wait for spell-to-world convergence
  -> request a checkpoint with Ctrl+S
  -> reload the same save
  -> verify terrain persistence
  -> continue moving after reload
```

## Two independent gates

### Deterministic diagnostic slice

The diagnostic route may pause at explicit readiness barriers. Every barrier is recorded as `diagnostic_barrier` evidence. This route is for locating the subsystem that failed.

It may use the existing observation and settle hooks, but it may not use diagnostic mutation hooks for dig, construction, spell casting, checkpointing, or movement.

### Continuous gameplay slice

The continuous route has no settle or readiness-barrier capability. Its action audit accepts only:

- `keyboard`;
- `pointer`;
- `navigation`.

A `diagnostic_barrier` action in a continuous report is an automatic failure.

Polling the read-only playable snapshot is allowed because it observes outcomes without changing the world.

## Public action routes

| Operation | Route |
|---|---|
| Move and sprint | `PlayerInputController` keyboard input |
| Aim | pointer lock and pointer movement |
| Dig | left pointer input and the normal terrain edit service |
| Build toggle | `B` keyboard input |
| Place | left pointer input and construction transaction |
| Break/delete | right pointer input and construction controller |
| Swim | movement input through canonical water authority |
| Earth spell | `Digit4` spell menu route |
| Checkpoint | `Ctrl+S` public checkpoint controller |
| Reload | browser navigation reload |

Route discovery is setup only. The existing continent river finder chooses a deterministic dry-bank approach, and the route planner selects a spawn eight metres before a real terrain page boundary. No gameplay mutation is performed during discovery.

## Checkpoint route

P7 adds a real checkpoint action instead of calling persistence internals from Playwright.

`Ctrl+S` performs:

```text
flush terrain ancestors
  -> flush dirty save regions
  -> publish completion or failure counters
```

Concurrent checkpoint requests are coalesced. Failures remain visible and are not reported as success.

Counters:

- `save_checkpoint_requests`;
- `save_checkpoint_completed`;
- `save_checkpoint_failed`;
- `save_checkpoint_in_flight`;
- `save_checkpoint_last_ms`.

## Read-only acceptance snapshot

`getPlayableSliceSnapshot` composes observation-only evidence for:

- frame and p95 responsiveness;
- player pose and terrain page;
- swim mode and canonical water body;
- terrain revision and voxel delta count;
- construction preview, visible pieces, colliders, stability, and transaction state;
- save load, dirty regions, checkpoint state, and persisted voxel count;
- P6 spell convergence;
- P1–P3 safety and recovery counters.

The snapshot cannot move the player or mutate any subsystem.

## Gates

A run fails when any of these occur:

- a required step is missing;
- the player does not cross a terrain page boundary;
- dig does not increase the authoritative terrain revision and voxel edit count;
- place or break does not change visible construction state;
- visible construction and collider counts diverge;
- canonical swim mode is never entered;
- the earth spell does not reach runtime convergence;
- checkpointing fails or returns with dirty regions pending;
- reload loses terrain edits or reports a save error;
- the player cannot continue after reload;
- collider coverage becomes missing;
- player recovery fires;
- synchronous frame collider builds increase;
- edit commands expire;
- frontier barriers exceed the configured near-zero allowance;
- wall-clock or frame responsiveness thresholds are exceeded;
- the continuous route records a diagnostic barrier.

Default responsiveness thresholds:

- wall clock: `180000 ms` per route;
- maximum sampled frame: `250 ms`;
- maximum sampled frame p95: `50 ms`;
- frontier barrier engagements: at most `1` per route.

## Repetition

The default command runs:

- five diagnostic routes in one repeated profile;
- five continuous routes in one repeated profile;
- one continuous route in a fresh browser profile.

Each route uses a unique save identity. The fresh-profile run uses a separate browser context with independent storage and HTTP cache.

## Evidence

The acceptance command writes:

```text
acceptance-runs/playable-slice/report.json
acceptance-runs/playable-slice/shots/*.png
```

The report includes the discovered river route, planned page crossing, public action audit, all ten step snapshots, frame maxima, wall-clock time, failures, and fresh-profile status.

## Verification

Run from native Windows PowerShell:

```powershell
npm --prefix tools/clod-poc run playable-slice:verify

npm --prefix tools/clod-poc run world:verify

# Start the app in another terminal first.
npm --prefix tools/clod-poc run dev

# Full P7 gate: 5 diagnostic + 5 continuous + 1 fresh profile.
npm --prefix tools/clod-poc run accept:playable-slice
```

Focused acceptance commands:

```powershell
npm --prefix tools/clod-poc run accept:playable-slice:diagnostic
npm --prefix tools/clod-poc run accept:playable-slice:continuous

# One-run development smoke, not release evidence.
npm --prefix tools/clod-poc run accept:playable-slice:continuous -- --runs=1
```

## Deliberate boundaries

- P7 does not add combat damage, mana, cooldowns, networking, sailing, or creature AI.
- The sparse continent route is the release gate in this phase.
- Direct diagnostic mutation hooks remain valid for subsystem-specific tests but are forbidden in the continuous P7 route.
- Passing unit tests does not certify P7. The real WebGPU acceptance report must also be green.
