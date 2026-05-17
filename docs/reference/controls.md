# Controls

Document status (2026-05-17): historical release/reference record; keep for versioned context, not current implementation instructions.

Keyboard and mode reference for Drusniel Voxels.

## General

* **Escape**: Toggle Pause Menu / Close Chat
* **M**: Toggle Map Overlay
* **Shift + M**: Toggle Edit Mode

## Debug & Development

* **F3**: Toggle Debug Overlay (FPS, position, chunk stats, targeted block info)
* **F4**: Dump current performance timing window to `perf-dumps/`
* **Shift+F4**: Toggle Inspector & Settings Window (LOD sliders, vegetation tweaks, foliage alpha fade, AO strength)
* **F5**: Toggle Mesh Mode (Blocky <-> SurfaceNets)
* **F6**: Toggle Water Visibility (debug builds only)
* **F7**: Toggle Grass Visibility (debug builds only)
* **F8**: Toggle Terrain AO Style (V0.3 soft <-> Full baked AO)
* **F9**: Toggle Ambient Occlusion (SSAO & GTAO)
* **Shift+F9**: Dump terrain hole probe JSON and cycle water reflection debug view
* **F10**: Toggle Sun Shadows (Cascaded Shadow Maps)
* **Shift+F10**: Dump water visual probe JSON
* **F11**: Toggle NAADF fullscreen preview (NAADF builds only)
* **Shift+F11**: Toggle enclosure culling force-disable/automatic
* **Shift+N**: Toggle NAADF split view (NAADF builds only)
* **F12**: Toggle Photo Mode (DoF, motion blur)
* **G**: Print Detailed Block Debug Info to Console

### F3 Overlay Sub-toggles

All F3 overlay sub-toggles use `Alt+`.

* **Alt+V**: Toggle Vertex Corners Display
* **Alt+T**: Toggle Texture Debug Details
* **Alt+N**: Toggle Multiplayer Debug Info
* **Alt+C**: Toggle Chunk Statistics (uniformity, LOD, mesh counts)
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

## Movement

* **W / A / S / D**: Move Forward, Left, Back, Right
* **Space**: Jump (Walk Mode) / Fly Up (Fly Mode)
* **Left Shift**: Sprint (Walk Mode) / Fly Down (Fly Mode)
* **Left Ctrl**: Turbo Speed (Fly Mode)
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
