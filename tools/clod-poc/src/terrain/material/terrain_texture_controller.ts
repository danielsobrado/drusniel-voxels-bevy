import * as THREE from "three";
import type { ProjectTextureSlot } from "../../project/voxel_project_archive.js";
import {
  emptyTextureSlotState,
  INITIAL_TERRAIN_TEXTURE_COUNT,
} from "../../terrain/terrain_textures.js";
import {
  disposeImportedTerrainTextureResources,
  loadImportedTerrainTextureResources,
} from "./terrain_texture_import_transaction.js";
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
  setBuiltinSlotNormal(
    index: number,
    texture: THREE.Texture,
    previewUrl: string,
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
  const importedSlots = deps.stagedImport?.manifest.textures;
  const slotCount = importedSlots?.length ?? INITIAL_TERRAIN_TEXTURE_COUNT;
  const slots: TerrainTextureSlot[] = Array.from({ length: slotCount }, () => ({
    ...emptyTextureSlotState(),
  }));

  for (let i = 0; i < slots.length; i++) {
    const imported = importedSlots?.[i];
    if (imported) {
      slots[i].name = imported.name;
      slots[i].selectedId = imported.selectedId;
      slots[i].scale = imported.scale;
      slots[i].heightMin = imported.heightMin;
      slots[i].heightMax = imported.heightMax;
      slots[i].customMimeType = imported.mimeType ?? null;
      slots[i].customExtension = imported.customPath?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? null;
      continue;
    }

    const preset = DEFAULT_TERRAIN_TEXTURE_PRESETS[i];
    if (!preset) continue;
    const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id);
    slots[i].selectedId = preset.id;
    slots[i].scale = preset.scale;
    slots[i].heightMin = preset.heightMin;
    slots[i].heightMax = preset.heightMax;
    slots[i].name = builtin?.label ?? preset.id;
  }

  let albedoArrayTex: THREE.DataArrayTexture | null = null;
  let normalArrayTex: THREE.DataArrayTexture | null = null;
  let textureArraySignature = "";
  let textureContentRevision = 0;
  const arrayBuildCanvas = document.createElement("canvas");
  arrayBuildCanvas.width = textureArraySize;
  arrayBuildCanvas.height = textureArraySize;
  const arrayBuildCtx = arrayBuildCanvas.getContext("2d", { willReadFrequently: true })!;

  const markTextureContentChanged = () => {
    textureContentRevision++;
  };

  const disposeTextureArrays = () => {
    albedoArrayTex?.dispose();
    normalArrayTex?.dispose();
    albedoArrayTex = null;
    normalArrayTex = null;
    textureArraySignature = "";
  };

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
    markTextureContentChanged();
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
    old.normalTexture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    slots[index] = {
      ...old,
      texture,
      name,
      previewUrl,
      selectedId,
      customBytes: null,
      customMimeType: null,
      customExtension: null,
      normalTexture: null,
      normalPreviewUrl: null,
      normalBytes: null,
      normalMimeType: null,
      normalExtension: null,
    };
    markTextureContentChanged();
  };

  const setBuiltinSlotNormal = (index: number, texture: THREE.Texture, previewUrl: string) => {
    const slot = slots[index];
    slot.normalTexture?.dispose();
    if (slot.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.normalPreviewUrl);
    slot.normalTexture = texture;
    slot.normalPreviewUrl = previewUrl;
    slot.normalBytes = null;
    slot.normalMimeType = null;
    slot.normalExtension = null;
    markTextureContentChanged();
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
    markTextureContentChanged();
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
    markTextureContentChanged();
  };

  const clearTextureSlot = (index: number) => {
    const slot = slots[index];
    slot.texture?.dispose();
    if (slot.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.previewUrl);
    clearSlotNormal(index);
    slots[index] = emptyTextureSlotState();
    markTextureContentChanged();
  };

  const clearAllTextures = () => {
    for (let i = 0; i < slots.length; i++) clearTextureSlot(i);
  };

  const addEmptySlot = () => {
    slots.push(emptyTextureSlotState());
    markTextureContentChanged();
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    clearTextureSlot(index);
    slots.splice(index, 1);
    markTextureContentChanged();
  };

  const ensureTextureArrays = (materialSource: string) => {
    if (materialSource !== "external_pbr") {
      disposeTextureArrays();
      return;
    }
    const signature = `${textureContentRevision}:${slots.length}`;
    if (signature === textureArraySignature) return;
    albedoArrayTex?.dispose();
    normalArrayTex?.dispose();
    albedoArrayTex = buildDataArray(slots.map((slot) => slot.texture?.image ?? null) as readonly (TexImageSource | null)[], THREE.SRGBColorSpace);
    normalArrayTex = buildDataArray(slots.map((slot) => slot.normalTexture?.image ?? null) as readonly (TexImageSource | null)[], THREE.NoColorSpace);
    textureArraySignature = signature;
  };

  const getAlbedoArray = () => albedoArrayTex;
  const getNormalArray = () => normalArrayTex;
  const hasAnyLoadedTexture = () => slots.some((slot) => slot.texture !== null);

  const loadBuiltinNormal = async (index: number, normalUrl: string | undefined) => {
    if (!normalUrl) return;
    const normalTexture = await loadTerrainTextureUrl(normalUrl, textureLoadOptions);
    if (!normalTexture) return;
    configureNormalTexture(normalTexture, textureLoadOptions);
    setBuiltinSlotNormal(index, normalTexture, normalUrl);
  };

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
      if (!texture) continue;
      setBuiltinTextureSlot(slot.index, texture, slot.name, builtin.url, slot.selectedId);
      await loadBuiltinNormal(slot.index, builtin.normalUrl);
    }
  };

  const restoreStagedImport = async (progress: TerrainTextureLoadProgress) => {
    const stagedImport = deps.stagedImport;
    if (!stagedImport) return;
    const resources = await loadImportedTerrainTextureResources({
      manifest: stagedImport.manifest.textures,
      customTextures: stagedImport.customTextures,
      options: textureLoadOptions,
      progress,
    });

    let committed = 0;
    try {
      for (const resource of resources) {
        const { slot } = resource;
        if (slot.source === "custom") {
          if (!resource.customBytes || !resource.customMimeType || !resource.customExtension) {
            throw new Error(`Imported custom texture slot ${slot.index} is incomplete`);
          }
          setTextureSlot(
            slot.index,
            resource.texture,
            slot.name,
            resource.previewUrl,
            resource.customBytes,
            resource.customMimeType,
            resource.customExtension,
          );
          if (resource.normalTexture && resource.normalPreviewUrl && resource.normalBytes && resource.normalMimeType && resource.normalExtension) {
            setSlotNormal(
              slot.index,
              resource.normalTexture,
              resource.normalPreviewUrl,
              resource.normalBytes,
              resource.normalMimeType,
              resource.normalExtension,
            );
          }
        } else {
          setBuiltinTextureSlot(slot.index, resource.texture, slot.name, resource.previewUrl, slot.selectedId);
          if (resource.normalTexture && resource.normalPreviewUrl) {
            setBuiltinSlotNormal(slot.index, resource.normalTexture, resource.normalPreviewUrl);
          }
        }
        committed++;
      }
    } catch (error) {
      disposeImportedTerrainTextureResources(resources.slice(committed));
      throw error;
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
    source: slot.selectedId === "" || slot.selectedId === "empty"
      ? "empty"
      : slot.selectedId === "custom"
        ? "custom"
        : "builtin",
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
    setBuiltinSlotNormal,
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
