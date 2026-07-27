# Circular rotating minimap

Player HUD dial ported from SimCity-DnD: north-up terrain bitmap, CSS/UI rotation by camera yaw, fixed forward needle, optional Azgaar burg rim markers.

## clod-poc

- Module: `src/ui/minimap.ts` + `minimap.css`
- Burg selection: `src/ui/minimap_burgs.ts`
- Mounted from `src/app/bootstrap/ui/ui_startup.ts`
- Enabled by default; disable with `?minimap=0`
- Window size: `?minimapCells=192` (default)

Heading comes from `window.__drusnielClod.getPose().yaw` each animation frame. The canvas stays north-up; `--minimap-heading` rotates the canvas and burg layer while the gold needle stays fixed pointing up.

## Bevy

- HUD plugin: `src/ui/minimap.rs` (`MinimapPlugin`)
- Burg selection: `src/ui/minimap_burgs.rs`
- Registered next to `MapPlugin` in `src/app/mod.rs`
- Local voxel color sample around the player; rotates with `PlayerCamera.yaw`
