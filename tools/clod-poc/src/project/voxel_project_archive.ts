import type { ClodProjectManifest, ProjectArchiveContents } from "./project_archive.js";
import { validateProjectManifest } from "./project_archive.js";
import type { ProjectPropInstance } from "./project_props.js";
import type { VoxelEditSnapshot } from "../terrain/terrain.js";

const PROJECT_FILE = "project.json";

export interface VoxelProjectManifestExtras {
  voxelTerrainEdits: VoxelEditSnapshot;
  props: readonly ProjectPropInstance[];
}

export type VoxelProjectManifest = ClodProjectManifest & VoxelProjectManifestExtras;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateVoxelEditSnapshot(value: unknown): VoxelEditSnapshot {
  if (!isRecord(value) || typeof value.revision !== "number" || !Array.isArray(value.deltas)) {
    return { revision: 0, deltas: [] };
  }

  return {
    revision: value.revision,
    deltas: value.deltas.filter(isRecord).map((delta) => ({
      x: Number(delta.x),
      y: Number(delta.y),
      z: Number(delta.z),
      density: Number(delta.density),
      materialSlot: delta.materialSlot === undefined ? undefined : Number(delta.materialSlot),
      revision: Number(delta.revision),
    })).filter((delta) =>
      Number.isSafeInteger(delta.x) &&
      Number.isSafeInteger(delta.y) &&
      Number.isSafeInteger(delta.z) &&
      Number.isFinite(delta.density) &&
      Number.isSafeInteger(delta.revision),
    ),
  };
}

function validateProps(value: unknown): ProjectPropInstance[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter((prop) =>
    typeof prop.id === "string" &&
    typeof prop.prefabId === "string" &&
    Array.isArray(prop.position) && prop.position.length === 3 &&
    Array.isArray(prop.rotation) && prop.rotation.length === 4 &&
    Array.isArray(prop.scale) && prop.scale.length === 3,
  ).map((prop) => ({
    id: String(prop.id),
    prefabId: String(prop.prefabId),
    position: prop.position as [number, number, number],
    rotation: prop.rotation as [number, number, number, number],
    scale: prop.scale as [number, number, number],
    anchor: prop.anchor === "terrain" || prop.anchor === "voxel" ? prop.anchor : "world",
  }));
}

export async function createVoxelProjectArchive(
  manifest: VoxelProjectManifest,
  customTextures: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate");
  const normalizedManifest = validateProjectManifest(manifest) as VoxelProjectManifest;
  normalizedManifest.voxelTerrainEdits = validateVoxelEditSnapshot(manifest.voxelTerrainEdits);
  normalizedManifest.props = validateProps(manifest.props);

  const files: import("fflate").Zippable = {
    [PROJECT_FILE]: [strToU8(JSON.stringify(normalizedManifest, null, 2)), { level: 6 }],
  };

  for (const slot of normalizedManifest.textures) {
    if (slot.source === "custom" && slot.customPath) {
      const bytes = customTextures.get(slot.customPath);
      if (!bytes) throw new Error(`Missing custom texture bytes for ${slot.customPath}`);
      files[slot.customPath] = [bytes, { level: 0 }];
    }
    if (slot.normalPath) {
      const bytes = customTextures.get(slot.normalPath);
      if (!bytes) throw new Error(`Missing normal-map bytes for ${slot.normalPath}`);
      files[slot.normalPath] = [bytes, { level: 0 }];
    }
  }

  return zipSync(files);
}

export async function parseVoxelProjectArchive(bytes: Uint8Array): Promise<ProjectArchiveContents> {
  const { strFromU8, unzipSync } = await import("fflate");
  const files = unzipSync(bytes);
  if (!files[PROJECT_FILE]) throw new Error("The archive is missing project.json");

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(strFromU8(files[PROJECT_FILE]));
  } catch {
    throw new Error("project.json is not valid JSON");
  }

  const manifest = validateProjectManifest(rawManifest) as VoxelProjectManifest;
  manifest.voxelTerrainEdits = validateVoxelEditSnapshot((rawManifest as Record<string, unknown>).voxelTerrainEdits);
  manifest.props = validateProps((rawManifest as Record<string, unknown>).props);

  const customTextures = new Map<string, Uint8Array>();
  for (const slot of manifest.textures) {
    if (slot.source === "custom" && slot.customPath) {
      const texture = files[slot.customPath];
      if (!texture) throw new Error(`The archive is missing ${slot.customPath}`);
      customTextures.set(slot.customPath, texture);
    }
    if (slot.normalPath) {
      const normal = files[slot.normalPath];
      if (!normal) throw new Error(`The archive is missing ${slot.normalPath}`);
      customTextures.set(slot.normalPath, normal);
    }
  }

  return { manifest, terrainGlb: new Uint8Array(), customTextures };
}
