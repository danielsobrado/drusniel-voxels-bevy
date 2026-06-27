export const ALL_AUDIO_EVENTS = [
  // UI
  "ui.click",
  "ui.hover",
  "ui.error",
  "ui.warning",
  "ui.success",
  "ui.toggle.on",
  "ui.toggle.off",
  // Project
  "project.import.open",
  "project.import.success",
  "project.import.error",
  "project.export.success",
  "project.export.error",
  // Camera
  "camera.mode.orbit",
  "camera.mode.player",
  // Texture/material
  "texture.dialog.open",
  "texture.dialog.close",
  "texture.slot.select",
  "texture.load.open",
  "texture.load.success",
  "texture.load.error",
  "material.paint",
  // Terrain tools
  "terrain.tool.select",
  "terrain.dig.start",
  "terrain.dig.tick",
  "terrain.dig.stop",
  "terrain.raise",
  "terrain.lower",
  "terrain.smooth",
  "terrain.brush.radius",
  // Spells
  "spell.fire.cast",
  "spell.water.cast",
  // CLOD/debug
  "clod.rebuild.start",
  "clod.rebuild.done",
  "clod.rebuild.error",
  "clod.validation.warning",
  "clod.validation.error",
  "clod.overlay.toggle",
  "clod.selection.freeze.on",
  "clod.selection.freeze.off",
  "clod.lod.toggle",
  "clod.wireframe.toggle",
  "clod.locked-border.toggle",
  "player.jump",
] as const;

export type AudioEventId = (typeof ALL_AUDIO_EVENTS)[number];
