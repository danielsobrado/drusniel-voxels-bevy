# Player edit authority and streaming stability progress

Scope: tools/clod-poc only. This document tracks the remaining player edit authority, construction commit, acceptance convergence, and near-field cache/dirty-queue work.

## Done before this document

- Added player editing YAML config at `config/player/player_editing.yaml`.
- Added shared player edit authority gates in `src/player/player_edit_authority.ts`.
- Added player edit authority tests.
- Gated terrain edit scheduling by player distance in `terrain_edit_startup.ts`.
- Gated construction terrain conform scheduling by player distance.
- Split construction preview and commit range in runtime startup.
- Added construction capture-phase commit guard.
- Made the construction commit guard support unbounded `infinite-*` scenes.
- Disposed the construction commit guard with the construction controller wrapper.
- Mirrored live-bubble GPU retry counters.
- Added acceptance threshold gates for live-bubble retry/failure counters.

## In progress

- Add defense-in-depth gates inside the mutation services, not only startup wrappers.
- Add direct construction-controller commit authority so the ghost turns invalid/red beyond commit range.
- Add convergence-wait awareness of live-bubble GPU retries.
- Add lightweight dirty-edit queue/event records.
- Add practical caches that can be landed safely without renderer rewrites.

## Validation required locally

Run after each coding slice:

```bash
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/player src/construction src/app/frame_loop src/app/bootstrap/ui src/app/bootstrap/runtime src/terrain/near_field
npm --prefix tools/clod-poc run accept:infinite-islands
```

## Notes

- No acceptance thresholds should be weakened.
- Far commits remain disabled unless explicitly enabled by query/config.
- Streamed CLOD roots and far shell remain render/cache systems, not terrain edit authorities.
