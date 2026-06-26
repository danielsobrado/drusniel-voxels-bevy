import * as THREE from "three";
import type { ProjectTextureSlot } from "../../project/voxel_project_archive.js";
import {
  emptyTextureSlotState,
  INITIAL_TERRAIN_TEXTURE_COUNT,
} from "../../terrain/terrain_textures.js";
import {
  configureNormalTexture,
  loadTerrainTextureUrl,
  type TerrainTextureLoadOptions,
} from "./texture_loader.js";
import {
  BUILTIN_TERRAIN_TEXTURES,
  DEFAULT_TERRAIN_TEXTURE_PRESETS,
} from "./terrain_builtin_textures.js";

export type TerrainTextureSlot = ReturnType<typeof emptyTextureSlotState>;

export interface TerrainTextureImportManifest {
  name: string;
  selectedId: string;
  scale: number;
  heightMin: number;
  heightMax: number;
  mimeType?: string | null;
  customPath?: string | null;
  source?: string;
  index: number;
  normalPath?: string | null;
  normalMimeType?: string | null;
}

export interface TerrainTextureControllerDeps {
  textureArraySize: number;
  textureMipmapsEnabled: boolean;
  maxAnisotropy: number;
  textureLoadOptions: TerrainTextureLoadOptions;
  stagedImport?: {
    manifest: { textures: TerrainTextureImportManifest[] };
    customTextures: Map<string, Uint8Array>;
  } | null;
}

export interface TerrainTextureLoadProgress {
  setPhase(label: string, fraction: number): void;
}

export interface TerrainTextureController {
  readonly slots: TerrainTextureSlot[];
  setTextureSlot(
    index: number,
    texture: THREE.Texture,
    name: string,
    previewUrl: string,
    customBytes: Uint8Array,
    customMimeType: string,
    customExtension: string,
  ): void;
  setBuiltinTextureSlot(
    index: number,
    texture: THREE.Texture,
    name: string,
    previewUrl: string,
    selectedId: string,
  ): void;
  clearTextureSlot(index: number): void;
  setSlotNormal(
    index: number,
    texture: THREE.Texture,
    previewUrl: string,
    bytes: Uint8Array,
    mimeType: string,
    extension: string,
  ): void;
  clearSlotNormal(index: number): void;
  clearAllTextures(): void;
  addEmptySlot(): void;
  removeSlot(index: number): void;
  ensureTextureArrays(materialSource: string): void;
  getAlbedoArray(): THREE.DataArrayTexture | null;
  getNormalArray(): THREE.DataArrayTexture | null;
  hasAnyLoadedTexture(): boolean;
  loadBuiltinTextureSlots(
    slots: readonly { index: number; selectedId: string; name: string }[],
    progress: TerrainTextureLoadProgress,
    phaseLabel: string,
  ): Promise<void>;
  restoreStagedImport(progress: TerrainTextureLoadProgress): Promise<void>;
  loadDefaultBuiltinTextures(progress: TerrainTextureLoadProgress): Promise<void>;
  projectTextureMetadata(): ProjectTextureSlot[];
}

export function createTerrainTextureController(deps: TerrainTextureControllerDeps): TerrainTextureController {
  const { textureArraySize, textureMipmapsEnabled, maxAnisotropy, textureLoadOptions } = deps;
  const slots: TerrainTextureSlot[] = Array.from({ length: INITIAL_TERRAIN_TEXTURE_COUNT }, () => ({
    ...emptyTextureSlotState(),
  }));

  for (let i = 0; i < slots.length; i++) {
    const preset = DEFAULT_TERRAIN_TEXTURE_PRESETS[i];
    const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id);
    slots[i].selectedId = preset.id;
    slots[i].scale = preset.scale;
    slots[i].heightMin = preset.heightMin;
    slots[i].heightMax = preset.heightMax;
    slots[i].name = builtin?.label ?? preset.id;
    const imported = deps.stagedImport?.manifest.textures[i];
    if (imported) {
      slots[i].name = imported.name;
      slots[i].selectedId = imported.selectedId;
      slots[i].scale = imported.scale;
      slots[i].heightMin = imported.heightMin;
      slots[i].heightMax = imported.heightMax;
      slots[i].customMimeType = imported.mimeType ?? null;
      slots[i].customExtension = imported.customPath?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? null;
    }
  }

  let albedoArrayTex: THREE.DataArrayTexture | null = null;
  let normalArrayTex: THREE.DataArrayTexture | null = null;
  let textureArraySignature = "";
  const arrayBuildCanvas = document.createElement("canvas");
  arrayBuildCanvas.width = textureArraySize;
  arrayBuildCanvas.height = textureArraySize;
  const arrayBuildCtx = arrayBuildCanvas.getContext("2d", { willReadFrequently: true })!;

  const buildDataArray = (
    images: readonly (TexImageSource | null)[],
    colorSpace: THREE.ColorSpace,
  ): THREE.DataArrayTexture | null => {
    if (images.every((img) => img === null)) return null;
    const size = textureArraySize;
    const layerStride = size * size * 4;
    const data = new Uint8Array(layerStride * images.length);
    for (let i = 0; i < images.length; i++) {
      arrayBuildCtx.save();
      arrayBuildCtx.clearRect(0, 0, size, size);
      arrayBuildCtx.translate(0, size);
      arrayBuildCtx.scale(1, -1);
      if (images[i]) arrayBuildCtx.drawImage(images[i] as CanvasImageSource, 0, 0, size, size);
      arrayBuildCtx.restore();
      data.set(arrayBuildCtx.getImageData(0, 0, size, size).data, i * layerStride);
    }
    const tex = new THREE.DataArrayTexture(data, size, size, images.length);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = colorSpace;
    tex.generateMipmaps = textureMipmapsEnabled;
    tex.minFilter = textureMipmapsEnabled ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = textureMipmapsEnabled ? maxAnisotropy : 1;
    tex.needsUpdate = true;
    return tex;
  };

  const setTextureSlot = (
    index: number,
    texture: THREE.Texture,
    name: string,
    previewUrl: string,
    customBytes: Uint8Array,
    customMimeType: string,
    customExtension: string,
  ) => {
    const old = slots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    slots[index] = {
      ...old,
      texture,
      name,
      previewUrl,
      selectedId: "custom",
      customBytes: customBytes.slice(),
      customMimeType,
      customExtension,
    };
  };

  const setBuiltinTextureSlot = (
    index: number,
    texture: THREE.Texture,
    name: string,
    previewUrl: string,
    selectedId: string,
  ) => {
    const old = slots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    slots[index] = {
      ...old,
      texture,
      name,
      previewUrl,
      selectedId,
      customBytes: null,
      customMimeType: null,
      customExtension: null,
    };
  };

  const setSlotNormal = (index: number, texture: THREE.Texture, previewUrl: string, bytes: Uint8Array, mimeType: string, extension: string) => {
    const slot = slots[index];
    slot.normalTexture?.dispose();
    if (slot.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.normalPreviewUrl);
    slot.normalTexture = texture;
    slot.normalPreviewUrl = previewUrl;
    slot.normalBytes = bytes.slice();
    slot.normalMimeType = mimeType;
    slot.normalExtension = extension;
  };

  const clearSlotNormal = (index: number) => {
    const slot = slots[index];
    slot.normalTexture?.dispose();
    if (slot.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.normalPreviewUrl);
    slot.normalTexture = null;
    slot.normalPreviewUrl = null;
    slot.normalBytes = null;
    slot.normalMimeType = null;
    slot.normalExtension = null;
  };

  const clearTextureSlot = (index: number) => {
    const slot = slots[index];
    slot.texture?.dispose();
    if (slot.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.previewUrl);
    clearSlotNormal(index);
    slots[index] = emptyTextureSlotState();
  };

  const clearAllTextures = () => {
    for (let i = 0; i < slots.length; i++) clearTextureSlot(i);
  };

  const addEmptySlot = () => slots.push(emptyTextureSlotState());
  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    clearTextureSlot(index);
    slots.splice(index, 1);
  };

  const ensureTextureArrays = (materialSource: string) => {
    if (materialSource !== "external_pbr") return;
    const signature = slots.map((slot) => `${slot.previewUrl ?? ""}:${slot.normalPreviewUrl ?? ""}:${slot.scale}:${slot.heightMin}:${slot.heightMax}`).join("|");
    if (signature === textureArraySignature) return;
    albedoArrayTex?.dispose();
    normalArrayTex?.dispose();
    albedoArrayTex = buildDataArray(slots.map((slot) => slot.texture?.image ?? null), THREE.SRGBColorSpace);
    normalArrayTex = buildDataArray(slots.map((slot) => slot.normalTexture?.image ?? null), THREE.NoColorSpace);
    textureArraySignature = signature;
  };

  const getAlbedoArray = () => albedoArrayTex;
  const getNormalArray = () => normalArrayTex;
  const hasAnyLoadedTexture = () => slots.some((slot) => slot.texture !== null);

  const loadBuiltinTextureSlots = async (
    slotManifests: readonly { index: number; selectedId: string; name: string }[],
    progress: TerrainTextureLoadProgress,
    phaseLabel: string,
  ) => {
    const builtinSlots = slotManifests.filter((slot) => slot.selectedId !== "empty" && slot.selectedId !== "custom");
    for (let i = 0; i < builtinSlots.length; i++) {
      const slot = builtinSlots[i];
      const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === slot.selectedId);
      if (!builtin) continue;
      progress.setPhase(`${phaseLabel} texture ${i + 1}/${builtinSlots.length}`, (i + 1) / Math.max(1, builtinSlots.length));
      const texture = await loadTerrainTextureUrl(builtin.url, textureLoadOptions);
      setBuiltinTextureSlot(slot.index, texture, slot.name, builtin.url, slot.selectedId);
    }
  };

  const restoreStagedImport = async (progress: TerrainTextureLoadProgress) => {
    const manifest = deps.stagedImport?.manifest;
    if (!manifest) return;
    const custom = manifest.textures.filter((slot) => slot.source === "custom" && slot.customPath);
    for (let i = 0; i < custom.length; i++) {
      const slot = custom[i];
      const bytes = deps.stagedImport?.customTextures.get(slot.customPath!);
      if (!bytes) throw new Error(`Imported project is missing ${slot.customPath}`);
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: slot.mimeType ?? "application/octet-stream" });
      const previewUrl = URL.createObjectURL(blob);
      const texture = await loadTerrainTextureUrl(previewUrl, textureLoadOptions);
      setTextureSlot(slot.index, texture, slot.name, previewUrl, bytes, slot.mimeType ?? "application/octet-stream", slot.customPath?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin");
      if (slot.normalPath) {
        const normalBytes = deps.stagedImport?.customTextures.get(slot.normalPath);
        if (!normalBytes) throw new Error(`Imported project is missing ${slot.normalPath}`);
        const normalBlob = new Blob([new Uint8Array(normalBytes).buffer as ArrayBuffer], { type: slot.normalMimeType ?? "application/octet-stream" });
        const normalPreviewUrl = URL.createObjectURL(normalBlob);
        const normalTexture = await loadTerrainTextureUrl(normalPreviewUrl, textureLoadOptions);
        configureNormalTexture(normalTexture, textureLoadOptions);
        setSlotNormal(slot.index, normalTexture, normalPreviewUrl, normalBytes, slot.normalMimeType ?? "application/octet-stream", slot.normalPath.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin");
      }
      progress.setPhase(`loading custom texture ${i + 1}/${custom.length}`, (i + 1) / Math.max(1, custom.length));
    }
  };

  const loadDefaultBuiltinTextures = async (progress: TerrainTextureLoadProgress) => {
    await loadBuiltinTextureSlots(DEFAULT_TERRAIN_TEXTURE_PRESETS.map((preset, index) => ({
      index,
      selectedId: preset.id,
      name: BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id)?.label ?? preset.id,
    })), progress, "loading default");
  };

  const projectTextureMetadata = (): ProjectTextureSlot[] => slots.map((slot, index) => ({
    index,
    source: slot.selectedId === "empty" ? "empty" : slot.selectedId === "custom" ? "custom" : "builtin",
    name: slot.name,
    selectedId: slot.selectedId,
    scale: slot.scale,
    heightMin: slot.heightMin,
    heightMax: slot.heightMax,
    customPath: slot.selectedId === "custom" && slot.customExtension ? `textures/slot-${index}${slot.customExtension}` : undefined,
    mimeType: slot.selectedId === "custom" ? slot.customMimeType ?? "application/octet-stream" : undefined,
    normalPath: slot.normalBytes && slot.normalExtension ? `textures/slot-${index}-normal${slot.normalExtension}` : undefined,
    normalMimeType: slot.normalBytes ? slot.normalMimeType ?? "application/octet-stream" : undefined,
  }));

  return {
    slots,
    setTextureSlot,
    setBuiltinTextureSlot,
    clearTextureSlot,
    setSlotNormal,
    clearSlotNormal,
    clearAllTextures,
    addEmptySlot,
    removeSlot,
    ensureTextureArrays,
    getAlbedoArray,
    getNormalArray,
    hasAnyLoadedTexture,
    loadBuiltinTextureSlots,
    restoreStagedImport,
    loadDefaultBuiltinTextures,
    projectTextureMetadata,
  };
}
