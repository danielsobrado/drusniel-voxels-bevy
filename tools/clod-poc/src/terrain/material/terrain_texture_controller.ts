import * as THREE from "three";
import type { ProjectTextureSlot } from "../../project/voxel_project_archive.js";
import {
  emptyTextureSlotState,
  INITIAL_TERRAIN_TEXTURE_COUNT,
} from "../../terrain/terrain_textures.js";
import {
  disposeImportedTerrainTextureResources,
  loadImportedTerrainTextureResources,
  type ImportedTerrainTextureResource,
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

function extension(path: string | null | undefined): string | null {
  return path?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? null;
}

function importedSlotState(
  manifest: TerrainTextureImportManifest,
  resource: ImportedTerrainTextureResource | undefined,
): TerrainTextureSlot {
  const slot: TerrainTextureSlot = {
    ...emptyTextureSlotState(),
    name: manifest.name,
    selectedId: manifest.selectedId,
    scale: manifest.scale,
    heightMin: manifest.heightMin,
    heightMax: manifest.heightMax,
    customMimeType: manifest.mimeType ?? null,
    customExtension: extension(manifest.customPath),
  };

  if (manifest.source === "empty") {
    if (resource) throw new Error(`Imported empty texture slot ${manifest.index} unexpectedly has a resource`);
    return slot;
  }
  if (!resource) throw new Error(`Imported texture slot ${manifest.index} has no loaded resource`);

  slot.texture = resource.texture;
  slot.previewUrl = resource.previewUrl;
  slot.normalTexture = resource.normalTexture;
  slot.normalPreviewUrl = resource.normalPreviewUrl;
  if (manifest.source === "custom") {
    if (!resource.customBytes || !resource.customMimeType || !resource.customExtension) {
      throw new Error(`Imported custom texture slot ${manifest.index} is incomplete`);
    }
    slot.selectedId = "custom";
    slot.customBytes = resource.customBytes.slice();
    slot.customMimeType = resource.customMimeType;
    slot.customExtension = resource.customExtension;
    slot.normalBytes = resource.normalBytes?.slice() ?? null;
    slot.normalMimeType = resource.normalMimeType;
    slot.normalExtension = resource.normalExtension;
  }
  return slot;
}

function disposeSlotResources(slot: TerrainTextureSlot): void {
  slot.texture?.dispose();
  slot.normalTexture?.dispose();
  if (slot.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.previewUrl);
  if (slot.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.normalPreviewUrl);
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
      slots[i] = importedSlotState(imported, undefined);
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
    disposeSlotResources(old);
    slots[index] = {
      ...old,
      texture,
      normalTexture: null,
      normalPreviewUrl: null,
      normalBytes: null,
      normalMimeType: null,
      normalExtension: null,
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
    disposeSlotResources(old);
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

  const setSlotNormal = (index: number, texture: THREE.Texture, previewUrl: string, bytes: Uint8Array, mimeType: string, normalExtension: string) => {
    const slot = slots[index];
    slot.normalTexture?.dispose();
    if (slot.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(slot.normalPreviewUrl);
    slot.normalTexture = texture;
    slot.normalPreviewUrl = previewUrl;
    slot.normalBytes = bytes.slice();
    slot.normalMimeType = mimeType;
    slot.normalExtension = normalExtension;
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
    disposeSlotResources(slots[index]);
    slots[index] = emptyTextureSlotState();
    markTextureContentChanged();
  };

  const clearAllTextures = () => {
    for (const slot of slots) disposeSlotResources(slot);
    slots.splice(0, slots.length, ...slots.map(() => emptyTextureSlotState()));
    markTextureContentChanged();
  };

  const addEmptySlot = () => {
    slots.push(emptyTextureSlotState());
    markTextureContentChanged();
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    disposeSlotResources(slots[index]);
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

    try {
      const resourcesByIndex = new Map(resources.map((resource) => [resource.slot.index, resource]));
      const nextSlots = stagedImport.manifest.textures.map((manifest) => (
        importedSlotState(manifest, resourcesByIndex.get(manifest.index))
      ));
      if (resourcesByIndex.size !== resources.length || resources.length !== nextSlots.filter((slot) => slot.texture !== null).length) {
        throw new Error("Imported texture resources do not match the manifest");
      }
      for (const slot of slots) disposeSlotResources(slot);
      slots.splice(0, slots.length, ...nextSlots);
      markTextureContentChanged();
    } catch (error) {
      disposeImportedTerrainTextureResources(resources);
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
