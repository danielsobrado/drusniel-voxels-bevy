# Controls

Document status (2026-06-05): current keyboard reference for the play-game runtime.

Keyboard and mode reference for Drusniel Voxels.

## General

* **Escape**: Toggle Pause Menu / Close Chat
* **M**: Toggle Map Overlay
* **Shift + M**: Toggle Edit Mode

## Debug & Development

* **F3**: Toggle Debug Overlay (FPS, position, chunk stats, targeted block info)
* **F4**: Dump current performance timing window to `perf-dumps/`
* **Shift+F4**: Toggle Game Tweaks window (LOD sliders, vegetation tweaks, foliage alpha fade, AO strength)
* **Ctrl+Shift+F4**: Toggle World Inspector while the Game Tweaks window is open
* **F5**: Toggle Mesh Mode (Blocky <-> SurfaceNets)
* **Alt+F5**: Toggle MC+Transvoxel LOD seam spike on/off (see [MC+Transvoxel A/B](#mc-transvoxel-ab-surface-nets-vs-mc) below)
* **F6**: Toggle Water Visibility (debug builds only; ignores Alt so it does not collide with Alt+F6)
* **Alt+F6**: Freeze / unfreeze terrain LOD for inspection. Pauses LOD **reassignment** only — already-loaded chunks keep their LOD while you move, and new chunks still load.
* **F7**: Toggle Grass Visibility (debug builds only; ignores Alt)
* **F8**: Toggle Terrain AO Style (V0.3 soft <-> Full baked AO)
* **F9**: Toggle Ambient Occlusion (SSAO & GTAO)
* **Alt+F10**: Dump terrain hole probe JSON (moved off Shift+F9 — Shift is fly-down)
* **Alt+Shift+F9**: Cycle water reflection debug view
* **F10**: Toggle Sun Shadows (Cascaded Shadow Maps)
* **Shift+F10**: Dump water visual probe JSON
* **F11**: Toggle NAADF fullscreen preview (default builds compile NAADF)
* **Alt+F11**: Toggle terrain morph-vector seam debug overlay
* **Shift+N**: Toggle NAADF split view with a yellow center divider (default builds compile NAADF)
* **Shift+F11**: Toggle enclosure culling force-disable/automatic
* **F12**: Toggle Photo Mode (DoF, motion blur)
* **G**: Print Detailed Block Debug Info to Console

### F3 Overlay Sub-toggles

All F3 overlay sub-toggles use `Alt+`.

* **Alt+V**: Toggle Vertex Corners Display
* **Alt+T**: Toggle Texture Debug Details
* **Alt+N**: Toggle Multiplayer Debug Info
* **Alt+C**: Toggle Chunk Statistics (uniformity, LOD, mesh counts; includes `MC+TVX: ON/OFF` and mesher stats)
* **Alt+P**: Toggle Prop Debug (targeted prop, alpha/fade info)
* **Alt+K**: Toggle Chunk Border Overlay (wireframe boxes per loaded chunk, colored by LOD)

### Adaptive GI Controls

All adaptive GI controls use `Alt+`.

* **Alt+1**: Low Quality (Approx. 8x faster, Contact Shadows OFF)
* **Alt+2**: Medium Quality
* **Alt+3**: High Quality (Default, Contact Shadows ON)
* **Alt+4**: Ultra Quality
* **Alt+P**: Toggle Probe Selection Debug Log
* **Alt+C**: Toggle Contact Shadows Debug Log (in console)

## MC+Transvoxel A/B (Surface Nets vs MC)

Experimental Marching Cubes + Transvoxel transition cells for LOD seams. Default builds compile the mesher (`mc_transvoxel` is a default Cargo feature). The spike is **off at startup** and toggled in-game — you do not need to edit YAML or restart to compare.

| Step | Action |
|------|--------|
| 1 | Stay on **Surface Nets** terrain: press **F5** until mesh mode is Surface Nets (not Blocky). |
| 2 | Open **F3** and enable chunk stats (**Alt+C**) so the overlay shows `MC+TVX: OFF`. |
| 3 | Press **Alt+F5** → `MC+TVX: ON`, all loaded chunks remesh with MC+Transvoxel (`mode` from [`assets/config/mc_transvoxel.yaml`](../../assets/config/mc_transvoxel.yaml), default `replace_surface_nets`). |
| 4 | Press **Alt+F5** again → back to Surface Nets (`MC+TVX: OFF`). |

**Notes:**

- **Alt+F5** flips [`McTransvoxelSettings::enabled`](../../src/voxel/mc_transvoxel/config.rs) for the session only; YAML `enabled:` is the startup default (`false` in the shipped file).
- Remeshing can take a moment after each toggle (same class of work as **F5**).
- **Alt+F7** wireframe: yellow edges = Transvoxel transition aprons when MC is on (see [wireframe plan](../lod/wireframe-debug-plan.md)).
- **Alt+F11** morph vectors: cyan lines show valid terrain seam morph targets from source vertex to target; red lines show invalid or oversized targets.
- **Alt+F10** hole-probe JSON works for both modes; compare dumps before/after Alt+F5 at the same camera pose.
- Builds without MC: `cargo run --no-default-features` — Alt+F5 logs a warning (stub mesher).
- Benches / scripts can still force MC via YAML (`enabled: true`) or `scripts/startVoxels.ps1 -Mc` (redundant if default features already include `mc_transvoxel`).

Details: [`docs/lod/mc-transvoxel-plan.md`](../lod/mc-transvoxel-plan.md).

## Movement

* **W / A / S / D**: Move Forward, Left, Back, Right
* **Space**: Jump (Walk Mode) / Fly Up (Fly Mode)
* **Left Shift**: Sprint (Walk Mode) / Fly Down (Fly Mode)
* **Left Ctrl**: Turbo Speed (Fly Mode)

> Fly Up/Down (Space / Left Shift) are suppressed while any function key (F1–F12) is held, so Shift-based debug chords (e.g. Shift+F10) don't nudge the camera mid-capture.
* **Tab**: Toggle Fly/Walk Mode
* **R**: Reset Position to Spawn

## Interaction

* **Left Click**: Break Block / Attack Entity
* **Right Click**: Place Block

## Terraforming Mode

Toggle with **T**.

* **T**: Toggle Mode (Switch Hotbar)
* **1**: Raise Tool
* **2**: Lower Tool
* **3**: Level Tool (Right-click to set target height)
* **4**: Smooth Tool
* **Left Click**: Apply Tool
* **Shift + Scroll**: Adjust Brush Radius
* **Ctrl + Scroll**: Adjust Brush Strength

## Edit Mode

Toggle with **Shift + M**.

* **Left Click + Drag**: Move Block
* **Q / E** or **Mouse Wheel**: Rotate Dragged Block
* **Delete**: Toggle Delete Mode
* **Left Click**: Delete Block while in Delete Mode

## Building Mode

Toggle with **B** to open the palette.

* **B**: Open/Close Placement Palette
* **Arrow Up/Down**: Navigate palette items
* **Enter**: Select highlighted item
* **X**: Toggle Snap Mode (snap to existing pieces vs free placement)
* **R**: Rotate piece 90 degrees when placing
* **Right Click**: Place building piece
* **Escape**: Close palette

Building pieces available in palette:

* Wood Floor 2x2 (Foundation)
* Wood Wall (2m x 2m)
* Wood Fence (2m x 1m)
* Wood Pillar (support column)

## Photo Mode

Toggle with **F12**.

* **Mouse Wheel**: Adjust Focus Distance
* **Q / E**: Adjust Aperture (f-stops)

## Chat

* **Ctrl + A**: Open Chat
* **Enter**: Send Message
