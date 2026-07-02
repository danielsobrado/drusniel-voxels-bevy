import type { TerrainTextureController } from "./terrain_texture_controller.js";
import type { TerrainTextureLoadOptions } from "./texture_loader.js";

export interface TerrainTextureModalDeps {
  textureController: TerrainTextureController;
  textureLoadOptions: TerrainTextureLoadOptions;
  applyTerrainTextures: () => void;
  setLoadedTextureFiles: (value: string) => void;
  onBrushMaterialClamped: (maxIndex: number) => void;
}

export interface TerrainTextureModal {
  actions: {
    loadTexture: () => void;
    clearTexture: () => void;
  };
  refreshTextureState: () => void;
  syncTextureModalControls: () => void;
  updateTextureSlotPreviews: () => void;
  rebuildTextureSlotCards: () => void;
  bindLoadedTextureController: (controller: { updateDisplay: () => unknown }) => void;
  closeTextureModal: () => void;
}
