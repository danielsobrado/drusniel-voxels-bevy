import type GUI from "lil-gui";
import {
  PROCEDURAL_DEBUG_MODES,
  TEXTURE_BLEND_MODES,
  TERRAIN_MATERIAL_SOURCES,
} from "../../terrain_runtime/terrain_material_constants.js";
import type { TerrainTextureModal } from "../../terrain_runtime/terrain_texture_modal.js";
import type { GuiController } from "./gui_controller.js";

export interface TerrainMaterialGuiDeps {
  textureModal: TerrainTextureModal;
  applyTerrainTextures: () => void;
  updateSelection: () => void;
  updateInfo: () => void;
  chunkGroups: Iterable<{ mats: Iterable<{ setBaseColor: (color: number) => void }> }>;
}

export interface TerrainMaterialGuiResult {
  digRadiusController: GuiController;
}

export function createTerrainMaterialGui(
  gui: GUI,
  state: Record<string, unknown>,
  deps: TerrainMaterialGuiDeps,
): TerrainMaterialGuiResult {
  const textureActions = deps.textureModal.actions;
  const textureFolder = gui.addFolder("terrain texture");
  textureFolder.add(state, "terrainMaterialSource", TERRAIN_MATERIAL_SOURCES).name("source").onChange(() => {
    deps.textureModal.refreshTextureState();
    deps.updateInfo();
  });
  textureFolder.add(state, "proceduralDebugMode", Object.keys(PROCEDURAL_DEBUG_MODES)).name("procedural debug").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "proceduralMicroNormals").name("procedural micro normals").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "albedo").name("albedo").onChange(deps.applyTerrainTextures);
  textureFolder.add(textureActions, "loadTexture").name("load albedo / normals");
  textureFolder.add(state, "triplanar").name("triplanar").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "normalMap").name("normal maps").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "normalIntensity", 0, 3, 0.05).name("normal intensity").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "roughness", 0, 1, 0.01).name("roughness").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "metalness", 0, 1, 0.01).name("metalness").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "textureScale", 0.25, 4, 0.05).name("scale multiplier").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "textureBlendMode", TEXTURE_BLEND_MODES).name("blend mode").onChange(deps.applyTerrainTextures);
  textureFolder.add(state, "textureBlendWidth", 0, 24, 0.5).name("blend height").onChange(deps.applyTerrainTextures);
  const loadedTextureController = textureFolder.add(state, "loadedTextureFiles").name("loaded").disable();
  deps.textureModal.bindLoadedTextureController(loadedTextureController);
  textureFolder.add(textureActions, "clearTexture").name("clear texture");

  const bubbleFolder = gui.addFolder("near-field bubble (§4.4)");
  bubbleFolder.add(state, "bubble").name("enable (raw chunks)").onChange(deps.updateSelection);
  bubbleFolder.add(state, "bubbleRadius", 16, 160, 1).name("radius (cells)").onChange(deps.updateSelection);
  bubbleFolder.add(state, "tintBubble").name("tint bubble red").onChange((on: boolean) => {
    for (const { mats } of deps.chunkGroups) {
      for (const m of mats) m.setBaseColor(on ? 0xc94b4b : 0xffffff);
    }
  });

  const digFolder = gui.addFolder("digging");
  digFolder.add(state, "digEnabled").name("dig on click").onChange(deps.updateInfo);
  const digRadiusController = digFolder
    .add(state, "digRadius", 1, 8, 0.5)
    .name("radius (cells)")
    .onChange(deps.updateInfo);

  return { digRadiusController };
}
