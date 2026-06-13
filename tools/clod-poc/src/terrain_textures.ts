export const MAX_TERRAIN_TEXTURES = 16;
export const INITIAL_TERRAIN_TEXTURE_COUNT = 4;

const LEGACY_BAND_LABELS = ["low", "mid low", "mid high", "high"];

export function terrainTextureSlotLabel(index: number): string {
  return LEGACY_BAND_LABELS[index] ?? `Material ${index + 1}`;
}

export function emptyTextureSlotState() {
  return {
    texture: null as null | import("three").Texture,
    normalTexture: null as null | import("three").Texture,
    normalPreviewUrl: null as string | null,
    normalBytes: null as Uint8Array | null,
    normalMimeType: null as string | null,
    normalExtension: null as string | null,
    name: "empty",
    previewUrl: null as string | null,
    selectedId: "",
    customBytes: null as Uint8Array | null,
    customMimeType: null as string | null,
    customExtension: null as string | null,
    scale: 1 / 64,
    heightMin: 0,
    heightMax: 0,
  };
}
