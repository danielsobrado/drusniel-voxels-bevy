import { load } from "js-yaml";
import type { PropInstance, PropPlacementScene } from "./prop_types.js";

interface YamlRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as YamlRecord) : undefined;
}

function vec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return [x, y, z];
}

function parseInstance(raw: YamlRecord): PropInstance | null {
  const assetId = typeof raw.asset_id === "string" ? raw.asset_id : typeof raw.assetId === "string" ? raw.assetId : "";
  const position = vec3(raw.position);
  if (!assetId || !position) return null;
  return {
    assetId,
    position,
    rotationY: typeof raw.rotation_y === "number" ? raw.rotation_y : typeof raw.rotationY === "number" ? raw.rotationY : 0,
    scale: typeof raw.scale === "number" && raw.scale > 0 ? raw.scale : 1,
    seed: typeof raw.seed === "number" ? raw.seed : 0,
    variationId:
      typeof raw.variation_id === "number"
        ? raw.variation_id
        : typeof raw.variationId === "number"
          ? raw.variationId
          : 0,
    flags: typeof raw.flags === "number" ? raw.flags : 0,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
  };
}

export function parsePropPlacements(text: string): PropPlacementScene {
  const raw = (load(text) ?? {}) as YamlRecord;
  const instances: PropInstance[] = [];
  if (Array.isArray(raw.instances)) {
    for (const entry of raw.instances) {
      const inst = parseInstance(asRecord(entry) ?? {});
      if (inst) instances.push(inst);
    }
  }
  return {
    schemaVersion: typeof raw.schema_version === "number" ? raw.schema_version : typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1,
    sceneId: typeof raw.scene_id === "string" ? raw.scene_id : typeof raw.sceneId === "string" ? raw.sceneId : "default",
    instances,
  };
}

export function assignPropCellCoords(
  instances: PropInstance[],
  cellSizeM: number,
): PropInstance[] {
  if (cellSizeM <= 0) return instances;
  return instances.map((inst) => ({
    ...inst,
    cellCoord: [
      Math.floor(inst.position[0] / cellSizeM),
      Math.floor(inst.position[2] / cellSizeM),
    ] as [number, number],
  }));
}

export function resolvePropPlacementScene(
  searchParams: URLSearchParams,
  scenes: Record<string, PropPlacementScene>,
  fallback: PropPlacementScene,
): PropPlacementScene {
  const sceneId = searchParams.get("customPropScene") ?? "smoke";
  if (sceneId === "smoke") return scenes.smoke ?? fallback;
  return scenes[sceneId] ?? fallback;
}
