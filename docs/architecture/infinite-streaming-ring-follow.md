# Infinite streaming ring follow contract

`tools/clod-poc` infinite scenes must keep all terrain ownership rings centered on the active view position each frame.

## Owner rings

| Ring | Owner | Center source |
| --- | --- | --- |
| Live editable terrain | Near-field bubble | Player position in play mode, orbit target in editor mode |
| CLOD visual pages | CLOD selection controller | Same selection center as the near-field bubble |
| Far shell annulus | Far shell controller or infinite far shell | Camera position each frame |

The far shell must never be a fixed world-origin ring in `infinite-*` scenes. The player should not be able to walk into the far shell; it must recede with the view.

## Runtime wiring

Frame-loop startup creates a far-summary callback for every `infinite-*` scene, even if there is no far-summary or NAADF integration. That callback calls:

```ts
farShellController.moveTo(camera.position.x, camera.position.z)
```

The infinite far shell path also calls:

```ts
infiniteFarShell.update(camera.position.x, camera.position.z, frameIndex)
```

The legacy controller call is intentionally kept because some scenes still use the older far-shell path.

## Diagnostics

The ownership diagnostics must keep reporting:

- `camera_to_clod_center_m`
- `camera_to_far_shell_center_m`
- `far_shell_inner_minus_clod_radius_m`
- `live_clod_gap_holes`
- `clod_far_gap_holes`
- `live_clod_overlap_cells`
- `far_shell_recenter_count`
- `far_shell_last_recenter_frame`

Acceptance for infinite streaming is:

- `streamer_far_shell_ownership_ok == 1`
- `camera_to_far_shell_center_m` remains near zero after the first frame
- no live/CLOD overlap cells
- no live/CLOD or CLOD/far gap holes

## Important constraint

Do not fix far-shell reachability by increasing cull distance. The playable region follows the camera; the far shell is an outer visual annulus only.
