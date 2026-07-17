# Playable-world P5 water authority and swimming

Created 2026-07-17.

## Scope

This phase adds gameplay water authority before adding water locomotion. Rendering remains a consumer and does not become the source of gameplay truth.

The canonical gameplay query is:

```ts
interface WaterSample {
  state: "dry" | "water" | "unknown";
  surfaceY: number;
  bottomY?: number;
  bodyId: string;
  bodyKind: "ocean" | "lake" | "river" | "pond" | "flood";
  flow: readonly [number, number];
  sourceRevision: number;
}
```

## Authority order

1. Edited water overlays.
2. Generated hydrology.
3. Legacy fake-body field only when no hydrology system exists.
4. Dry when no source owns the point.

Edited water may add a pond, flood, reservoir, or cave body. An edited `dry` overlay is an authoritative removal or dam and therefore also overrides generated water.

Overlapping edited bodies resolve by explicit priority and then stable body ID. The composed authority revision changes when any source revision changes.

## Readiness

`CellReadiness` now includes `waterQueryReady`.

A missing streamed hydrology tile is `unknown`, never dry. Spawn, teleport, and movement frontier checks fail closed until the water query is ready. This prevents the player from walking into an unloaded lake or switching between walking and swimming based on guessed absence.

Inside the startup hydrology grid, gameplay samples the canonical CPU grid. Outside it, gameplay requires the resident tile authority when the streaming atlas exists.

## Visual versus authoritative water

Authoritative:

- generated hydrology surface, bottom, body identity, and flow;
- edited water overlays and dry overrides;
- player swim state and forces.

Visual only:

- shore-surf render bands;
- water clipmap exclusion bands;
- foam, residue, cascade particles, normals, and shading;
- the deep-ocean render ring outside the playable world.

The visual `WaterField` is used as gameplay fallback only in worlds without hydrology. Visual shore shaping never changes gameplay immersion.

## Swimming

Swimming runs in the existing 120 Hz player fixed step.

- Enter and exit use separate submersion thresholds to prevent shore flicker.
- Surface swimming targets a configured immersion depth with bounded buoyancy.
- `Space` ascends.
- `Ctrl` dives.
- Horizontal motion accelerates toward swim speed.
- River flow contributes to player velocity.
- Horizontal and vertical drag are exponential and step-size stable.
- Unknown water freezes the player at the readiness frontier instead of treating the cell as dry.

All tuning is in `config/player/swimming.yaml`.

## Acceptance coverage

- Edited water beats generated water.
- Dry overlays dam or remove generated water.
- Cave ponds work below the surface world.
- Unknown water blocks readiness and locomotion.
- Shore entry/exit hysteresis is stable.
- Lake traversal works through the live player controller.
- River flow moves an idle swimmer.
- Surface and dive controls produce opposite vertical motion.
- Results match across 60, 30, and 20 FPS frame chunking because forces run at the fixed step.

## Deferred

- Generic rigid-body buoyancy.
- Boats and vehicle water physics.
- Waves changing gameplay surface height.
- Network replication of edited water bodies.
- Automatic voxel-water extraction from arbitrary material edits.

## Verification

Run from native Windows PowerShell:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/water/water_authority.test.ts src/player/swim_locomotion.test.ts src/player/swim_player_controller.test.ts src/player/cell_readiness.test.ts src/player_controller.test.ts
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run water:hydrology
npm --prefix tools/clod-poc run water:streaming
npm --prefix tools/clod-poc run world:verify
```
