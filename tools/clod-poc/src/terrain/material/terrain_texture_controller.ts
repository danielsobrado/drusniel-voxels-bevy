import * as THREE from "three";
import type { ProjectTextureSlot } from "../../project_archive.js";
import {
  emptyTextureSlotState,
  INITIAL_TERRAIN_TEXTURE_COUNT,
} from "../../terrain_textures.js";
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

  const clearTextureSlot = (index: number) => {
    const old = slots[index];
    old.texture?.dispose();
    old.normalTexture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    slots[index] = {
      ...old,
      texture: null,
      normalTexture: null,
      normalPreviewUrl: null,
      name: "empty",
      previewUrl: null,
      selectedId: "",
      customBytes: null,
      customMimeType: null,
      customExtension: null,
    };
  };

  const setSlotNormal = (
    index: number,
    texture: THREE.Texture,
    previewUrl: string,
    bytes: Uint8Array,
    mimeType: string,
    extension: string,
  ) => {
    const old = slots[index];
    old.normalTexture?.dispose();
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    slots[index] = {
      ...old,
      normalTexture: texture,
      normalPreviewUrl: previewUrl,
      normalBytes: bytes.slice(),
      normalMimeType: mimeType,
      normalExtension: extension,
    };
  };

  const clearSlotNormal = (index: number) => {
    const old = slots[index];
    old.normalTexture?.dispose();
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    slots[index] = {
      ...old,
      normalTexture: null,
      normalPreviewUrl: null,
      normalBytes: null,
      normalMimeType: null,
      normalExtension: null,
    };
  };

  const loadBuiltinTextureSlots = async (
    loadSlots: readonly { index: number; selectedId: string; name: string }[],
    progress: TerrainTextureLoadProgress,
    phaseLabel: string,
  ) => {
    if (loadSlots.length === 0) return;
    progress.setPhase(phaseLabel, 0.9);
    const failed: string[] = [];
    for (const slot of loadSlots) {
      const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === slot.selectedId);
      if (!builtin) throw new Error(`Unknown texture ${slot.selectedId}`);
      const texture = await loadTerrainTextureUrl(builtin.url, textureLoadOptions);
      if (!texture) {
        console.error(`[textures] could not load ${slot.name} (${builtin.url}); continuing without it`);
        failed.push(slot.name);
        continue;
      }
      setBuiltinTextureSlot(slot.index, texture, slot.name, builtin.url, builtin.id);
    }
    if (failed.length) console.warn(`[textures] ${failed.length} built-in texture(s) failed to load: ${failed.join(", ")}`);
  };

  const restoreStagedImport = async (progress: TerrainTextureLoadProgress) => {
    const stagedImport = deps.stagedImport;
    if (!stagedImport) return;
    while (slots.length < stagedImport.manifest.textures.length) {
      slots.push({ ...emptyTextureSlotState() });
    }
    await loadBuiltinTextureSlots(
      stagedImport.manifest.textures.filter((slot) => slot.source === "builtin").map((slot) => ({
        index: slot.index,
        selectedId: slot.selectedId,
        name: slot.name,
      })),
      progress,
      "restoring textures",
    );
    for (const imported of stagedImport.manifest.textures) {
      if (imported.source === "builtin") continue;
      if (imported.source === "custom" && imported.customPath) {
        const bytes = stagedImport.customTextures.get(imported.customPath);
        if (!bytes) throw new Error(`Imported project is missing ${imported.customPath}`);
        const mimeType = imported.mimeType ?? "application/octet-stream";
        const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeType }));
        const texture = await loadTerrainTextureUrl(previewUrl, textureLoadOptions);
        if (!texture) {
          URL.revokeObjectURL(previewUrl);
          throw new Error(`Could not decode imported texture ${imported.name}`);
        }
        setTextureSlot(
          imported.index,
          texture,
          imported.name,
          previewUrl,
          bytes,
          mimeType,
          imported.customPath.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin",
        );
      }
    }
    for (const imported of stagedImport.manifest.textures) {
      if (!imported.normalPath) continue;
      const bytes = stagedImport.customTextures.get(imported.normalPath);
      if (!bytes) throw new Error(`Imported project is missing ${imported.normalPath}`);
      const mimeType = imported.normalMimeType ?? "application/octet-stream";
      const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeType }));
      const texture = await new Promise<THREE.Texture | null>((resolve) => {
        new THREE.TextureLoader().load(
          previewUrl,
          (t) => { configureNormalTexture(t, textureLoadOptions); resolve(t); },
          undefined,
          () => resolve(null),
        );
      });
      if (!texture) {
        URL.revokeObjectURL(previewUrl);
        throw new Error(`Could not decode imported normal map for slot ${imported.index}`);
      }
      setSlotNormal(
        imported.index,
        texture,
        previewUrl,
        bytes,
        mimeType,
        imported.normalPath.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin",
      );
    }
  };

  return {
    slots,
    setTextureSlot,
    setBuiltinTextureSlot,
    clearTextureSlot,
    setSlotNormal,
    clearSlotNormal,
    clearAllTextures: () => {
      for (let i = 0; i < slots.length; i++) clearTextureSlot(i);
    },
    addEmptySlot: () => {
      slots.push({ ...emptyTextureSlotState(), heightMin: 0, heightMax: 128 });
    },
    removeSlot: (index: number) => {
      if (slots.length <= INITIAL_TERRAIN_TEXTURE_COUNT) return;
      clearTextureSlot(index);
      slots.splice(index, 1);
    },
    ensureTextureArrays: (materialSource: string) => {
      if (materialSource !== "external_pbr") return;
      const signature = slots
        .map((s) => `${s.texture?.uuid ?? "_"}:${s.normalTexture?.uuid ?? "_"}`)
        .join("|");
      if (signature === textureArraySignature) return;
      textureArraySignature = signature;
      albedoArrayTex?.dispose();
      normalArrayTex?.dispose();
      albedoArrayTex = buildDataArray(
        slots.map((s) => (s.texture?.image as TexImageSource | undefined) ?? null),
        THREE.SRGBColorSpace,
      );
      normalArrayTex = buildDataArray(
        slots.map((s) => (s.normalTexture?.image as TexImageSource | undefined) ?? null),
        THREE.NoColorSpace,
      );
    },
    getAlbedoArray: () => albedoArrayTex,
    getNormalArray: () => normalArrayTex,
    hasAnyLoadedTexture: () => slots.some((slot) => slot.texture !== null),
    loadBuiltinTextureSlots,
    restoreStagedImport,
    loadDefaultBuiltinTextures: (progress) => loadBuiltinTextureSlots(
      DEFAULT_TERRAIN_TEXTURE_PRESETS.map((preset, index) => ({
        index,
        selectedId: preset.id,
        name: BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id)?.label ?? preset.id,
      })),
      progress,
      "loading textures",
    ),
    projectTextureMetadata: () => slots.map((slot, index) => {
      const source: ProjectTextureSlot["source"] = slot.texture === null
        ? "empty"
        : slot.selectedId === "custom" ? "custom" : "builtin";
      const customPath = source === "custom" ? `textures/slot-${index}${slot.customExtension ?? ".bin"}` : undefined;
      const normalPath = slot.normalBytes ? `textures/slot-${index}-normal${slot.normalExtension ?? ".bin"}` : undefined;
      return {
        index,
        source,
        name: source === "empty" ? "empty" : slot.name,
        selectedId: source === "empty" ? "" : slot.selectedId,
        scale: slot.scale,
        heightMin: slot.heightMin,
        heightMax: slot.heightMax,
        ...(customPath ? { customPath, mimeType: slot.customMimeType ?? "application/octet-stream" } : {}),
        ...(normalPath ? { normalPath, normalMimeType: slot.normalMimeType ?? "application/octet-stream" } : {}),
      };
    }),
  };
}
