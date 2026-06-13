# CLOD Pages PoC - Procedural Audio Event System

This document describes the design, implementation, and expansion protocol for the procedural WebAudio event system in the CLOD Pages Proof-of-Concept sandbox.

## Event Vocabulary

The audio system operates strictly via the `AudioEventId` type, which covers the following event ids:

### UI Events
- `ui.click`: Fired on generic button/interactive element clicks.
- `ui.hover`: Fired on pointer hover over interactive elements.
- `ui.error`: Fired on generic UI errors.
- `ui.warning`: Fired on generic UI warnings.
- `ui.success`: Fired on generic UI success conditions.
- `ui.toggle.on`: Fired when an interactive checkbox/toggle is turned ON.
- `ui.toggle.off`: Fired when an interactive checkbox/toggle is turned OFF.

### Project Lifecycle Events
- `project.import.open`: Fired when opening the project import file selection.
- `project.import.success`: Fired when a staged project zip is successfully loaded and built.
- `project.import.error`: Fired when a project archive fails parsing, loading, or building.
- `project.export.success`: Fired when all LOD meshes and custom textures are successfully compiled and downloaded.
- `project.export.error`: Fired when project compilation or packing fails.

### Camera Events
- `camera.mode.orbit`: Fired when returning to the Orbit camera.
- `camera.mode.player`: Fired when entering the First-person Player mode.

### Texture and Material Events
- `texture.dialog.open`: Fired when opening the texture slot configuration modal.
- `texture.dialog.close`: Fired when closing the texture slot configuration modal.
- `texture.slot.select`: Fired when selecting a texture slot swatch or option.
- `texture.load.open`: Fired when initiating a local file texture/normal map upload.
- `texture.load.success`: Fired when a custom texture/normal map is decoded and loaded successfully.
- `texture.load.error`: Fired when custom image decoding or loading fails.
- `material.paint`: Fired when applying sculpt paint edits to the terrain using the "add" operation.

### Terrain Tool Events
- `terrain.tool.select`: Fired when changing the brush operation (dig vs raise) or brush shape (sphere, cube, cylinder).
- `terrain.dig.start`: Fired when clicking down to start sculpting.
- `terrain.dig.tick`: Fired during held/continuous sculpting edits.
- `terrain.dig.stop`: Fired when releasing the mouse button to stop sculpting.
- `terrain.raise`: Fired during terrain sculpt raise/fill operations.
- `terrain.lower`: Fired during terrain sculpt dig/lower operations.
- `terrain.smooth`: Fired during terrain smooth sculpting operations (when using the sphere sculpt shape).
- `terrain.brush.radius`: Fired when scrolling or sliding to adjust the brush radius.

### CLOD Rebuild & Debug Events
- `clod.rebuild.start`: Fired when a dynamic terrain edit initiates a page mesh rebuild.
- `clod.rebuild.done`: Fired when the dynamic edit finishes rebuilding and the ancestor chain settles.
- `clod.rebuild.error`: Fired when page mesh generation or simplification fails.
- `clod.validation.warning`: Fired when selection splits encounter an unresolvable max-LOD constraint.
- `clod.validation.error`: Fired when weld verification detects topological border gaps or mismatch.
- `clod.overlay.toggle`: Fired when toggling screen boundaries, seam points, cross-LOD borders, or floating node labels.
- `clod.selection.freeze.on`: Fired when enabling the freeze selection state.
- `clod.selection.freeze.off`: Fired when disabling the freeze selection state.
- `clod.lod.toggle`: Fired when toggling the "color by LOD" visualizer.
- `clod.wireframe.toggle`: Fired when toggling Alt+F7 wireframe overlays.
- `clod.locked-border.toggle`: Fired when toggling locked border vertex highlights.

---

## Lazy WebAudio Initialization

Modern web browsers enforce autoplay policies that restrict web pages from creating or starting an `AudioContext` until a user interaction (like clicking a button or pressing a key) takes place.

To comply with these rules:
1. No `AudioContext` is created or initialized at module import time.
2. The `AudioBus` hooks up capture-phase event listeners (`pointerdown`, `keydown`, `click` on the `window` object) during page load.
3. Upon the very first user interaction:
   - The event listeners trigger `.init()`.
   - `AudioContext` is instantiated and un-suspended.
   - The white noise generator buffer is initialized.
   - The capture-phase event listeners are detached.
4. If the browser blocks WebAudio or the device lacks an audio device, the system enters a safe **no-op fallback mode**, ensuring the game sandbox runs normally without throwing exceptions.

---

## Throttling and Cooldowns

Terrain sculpting tools (`terrain.dig.tick`) and scroll-wheel brush adjustments (`terrain.brush.radius`) can execute dozens of times per second (on every animation frame). Playing audio tones on every frame would result in unpleasant, metallic clipping and audio distortion.

To prevent this:
- The `AudioThrottle` manager maps each event ID to its configured `cooldown_ms` (specified in `config/audio_events.yaml`).
- When `emitAudio(eventId)` is called, the system checks the delta since the event was last played.
- If the delta is less than `cooldown_ms`, the event play is throttled and ignored.
- For rare system-critical events, the `force` option in `AudioEventOptions` can bypass the throttle. This bypass is intentionally omitted for high-frequency actions like terrain ticks.
- Default cooldown examples:
  - `terrain.dig.tick`: `120ms`
  - `terrain.brush.radius`: `80ms`
  - `ui.click`: `35ms`

---

## Expanding the Audio System

To add a new audio event:

1. **Register the Event ID**:
   Add the new event ID string to the `AudioEventId` union type and the `ALL_AUDIO_EVENTS` array in [audio_event_id.ts](file:///f:/Development/workspace/GitHub/drusniel-voxels-bevy/tools/clod-poc/src/audio/audio_event_id.ts).

2. **Add Configuration**:
   Open [audio_events.yaml](file:///f:/Development/workspace/GitHub/drusniel-voxels-bevy/tools/clod-poc/config/audio_events.yaml) and add a configuration entry mapping to the new event:
   ```yaml
   events:
     my.new.event:
       enabled: true
       volume: 0.15
       cooldown_ms: 100
       synth: click
       pitch: 1200
       duration_ms: 60
   ```

3. **Define a Synth Recipe** (Optional):
   If you need a new sound profile, open [procedural_audio.ts](file:///f:/Development/workspace/GitHub/drusniel-voxels-bevy/tools/clod-poc/src/audio/procedural_audio.ts) and add a new case in the `playSynth` switch statement. Synths should remain lightweight combinations of oscillators (`tone`) and white noise (`noise`) with simple gain envelopes.

4. **Emit the Event**:
   Import `emitAudio` and trigger the event at the source:
   ```typescript
   import { emitAudio } from "./audio/index.js";
   emitAudio("my.new.event");
   ```

---

## Source Attribution

The synth recipes and oscillator/noise routing are adapted from the MIT-licensed World of Claudecraft audio reference under `tools/clod-poc/reference/world-of-claudecraft-audio`. It has been completely redesigned to run in a standalone TypeScript/Vite environment, integrated with YAML-driven configs, throttle controls, user preference persistence, and custom sandboxed UI/build lifecycles.
