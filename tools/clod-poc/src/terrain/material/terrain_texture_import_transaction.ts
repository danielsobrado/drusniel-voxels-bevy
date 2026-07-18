import * as THREE from "three";
import { BUILTIN_TERRAIN_TEXTURES } from "./terrain_builtin_textures.js";
import {
  configureNormalTexture,
  loadTerrainTextureUrl,
  type TerrainTextureLoadOptions,
} from "./texture_loader.js";
import type {
  TerrainTextureImportManifest,
  TerrainTextureLoadProgress,
} from "./terrain_texture_controller.js";

export interface ImportedTerrainTextureResource {
  readonly slot: TerrainTextureImportManifest;
  readonly texture: THREE.Texture;
  readonly previewUrl: string;
  readonly customBytes: Uint8Array | null;
  readonly customMimeType: string | null;
  readonly customExtension: string | null;
  readonly normalTexture: THREE.Texture | null;
  readonly normalPreviewUrl: string | null;
  readonly normalBytes: Uint8Array | null;
  readonly normalMimeType: string | null;
  readonly normalExtension: string | null;
  readonly revokePreviewUrl: boolean;
  readonly revokeNormalPreviewUrl: boolean;
}

function extension(path: string | null | undefined): string {
  return path?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin";
}

function disposeResource(resource: ImportedTerrainTextureResource): void {
  resource.texture.dispose();
  resource.normalTexture?.dispose();
  if (resource.revokePreviewUrl) URL.revokeObjectURL(resource.previewUrl);
  if (resource.revokeNormalPreviewUrl && resource.normalPreviewUrl) {
    URL.revokeObjectURL(resource.normalPreviewUrl);
  }
}

export function disposeImportedTerrainTextureResources(
  resources: readonly ImportedTerrainTextureResource[],
): void {
  for (const resource of resources) disposeResource(resource);
}

async function loadNormalResource(input: {
  path: string;
  mimeType: string | null | undefined;
  bytes: Uint8Array;
  options: TerrainTextureLoadOptions;
}): Promise<{
  texture: THREE.Texture;
  previewUrl: string;
  mimeType: string;
  extension: string;
}> {
  const mimeType = input.mimeType ?? "application/octet-stream";
  const blob = new Blob([new Uint8Array(input.bytes).buffer as ArrayBuffer], { type: mimeType });
  const previewUrl = URL.createObjectURL(blob);
  const texture = await loadTerrainTextureUrl(previewUrl, input.options);
  if (!texture) {
    URL.revokeObjectURL(previewUrl);
    throw new Error(`Imported project could not decode ${input.path}`);
  }
  configureNormalTexture(texture, input.options);
  return { texture, previewUrl, mimeType, extension: extension(input.path) };
}

async function loadCustomResource(input: {
  slot: TerrainTextureImportManifest;
  customTextures: ReadonlyMap<string, Uint8Array>;
  options: TerrainTextureLoadOptions;
}): Promise<ImportedTerrainTextureResource> {
  const { slot, customTextures, options } = input;
  if (!slot.customPath) throw new Error(`Imported custom texture slot ${slot.index} is missing its path`);
  const bytes = customTextures.get(slot.customPath);
  if (!bytes) throw new Error(`Imported project is missing ${slot.customPath}`);
  const mimeType = slot.mimeType ?? "application/octet-stream";
  const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeType });
  const previewUrl = URL.createObjectURL(blob);
  const texture = await loadTerrainTextureUrl(previewUrl, options);
  if (!texture) {
    URL.revokeObjectURL(previewUrl);
    throw new Error(`Imported project could not decode ${slot.customPath}`);
  }

  let normal: Awaited<ReturnType<typeof loadNormalResource>> | null = null;
  try {
    if (slot.normalPath) {
      const normalBytes = customTextures.get(slot.normalPath);
      if (!normalBytes) throw new Error(`Imported project is missing ${slot.normalPath}`);
      normal = await loadNormalResource({
        path: slot.normalPath,
        mimeType: slot.normalMimeType,
        bytes: normalBytes,
        options,
      });
    }
    return {
      slot,
      texture,
      previewUrl,
      customBytes: bytes,
      customMimeType: mimeType,
      customExtension: extension(slot.customPath),
      normalTexture: normal?.texture ?? null,
      normalPreviewUrl: normal?.previewUrl ?? null,
      normalBytes: slot.normalPath ? customTextures.get(slot.normalPath) ?? null : null,
      normalMimeType: normal?.mimeType ?? null,
      normalExtension: normal?.extension ?? null,
      revokePreviewUrl: true,
      revokeNormalPreviewUrl: normal !== null,
    };
  } catch (error) {
    texture.dispose();
    URL.revokeObjectURL(previewUrl);
    if (normal) {
      normal.texture.dispose();
      URL.revokeObjectURL(normal.previewUrl);
    }
    throw error;
  }
}

async function loadBuiltinResource(input: {
  slot: TerrainTextureImportManifest;
  options: TerrainTextureLoadOptions;
}): Promise<ImportedTerrainTextureResource> {
  const { slot, options } = input;
  const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === slot.selectedId);
  if (!builtin) throw new Error(`Imported project references unknown built-in texture ${slot.selectedId}`);
  const texture = await loadTerrainTextureUrl(builtin.url, options);
  if (!texture) throw new Error(`Imported project could not load built-in texture ${slot.selectedId}`);

  let normalTexture: THREE.Texture | null = null;
  try {
    if (builtin.normalUrl) {
      normalTexture = await loadTerrainTextureUrl(builtin.normalUrl, options);
      if (!normalTexture) throw new Error(`Imported project could not load the normal map for ${slot.selectedId}`);
      configureNormalTexture(normalTexture, options);
    }
    return {
      slot,
      texture,
      previewUrl: builtin.url,
      customBytes: null,
      customMimeType: null,
      customExtension: null,
      normalTexture,
      normalPreviewUrl: builtin.normalUrl ?? null,
      normalBytes: null,
      normalMimeType: null,
      normalExtension: null,
      revokePreviewUrl: false,
      revokeNormalPreviewUrl: false,
    };
  } catch (error) {
    texture.dispose();
    normalTexture?.dispose();
    throw error;
  }
}

export async function loadImportedTerrainTextureResources(input: {
  manifest: readonly TerrainTextureImportManifest[];
  customTextures: ReadonlyMap<string, Uint8Array>;
  options: TerrainTextureLoadOptions;
  progress: TerrainTextureLoadProgress;
}): Promise<ImportedTerrainTextureResource[]> {
  const loadable = input.manifest.filter((slot) => slot.source === "custom" || slot.source === "builtin");
  const resources: ImportedTerrainTextureResource[] = [];
  try {
    for (let i = 0; i < loadable.length; i++) {
      const slot = loadable[i]!;
      const resource = slot.source === "custom"
        ? await loadCustomResource({ slot, customTextures: input.customTextures, options: input.options })
        : await loadBuiltinResource({ slot, options: input.options });
      resources.push(resource);
      input.progress.setPhase(
        `loading imported texture ${i + 1}/${loadable.length}`,
        (i + 1) / Math.max(1, loadable.length),
      );
    }
    return resources;
  } catch (error) {
    disposeImportedTerrainTextureResources(resources);
    throw error;
  }
}
