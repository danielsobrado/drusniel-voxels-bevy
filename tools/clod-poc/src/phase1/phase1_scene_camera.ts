import { parsePhase1Config, normalizePhase1DebugMode } from "./phase1_config.js";
import type { Phase1SceneParams } from "./phase1_scene_types.js";

export const DEFAULT_PHASE1_CAM = "1800,360,3200,2.6500,-0.4300,55";

function intParam(q: URLSearchParams, key: string, fallback: number, allowed?: readonly number[]): number {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0 && (!allowed || allowed.includes(value))) return value;
  console.warn(`[phase1] invalid ${key}=${raw}; using ${fallback}`);
  return fallback;
}

function numParam(q: URLSearchParams, key: string): number | null {
  const raw = q.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`[phase1] invalid ${key}=${raw}; ignoring`);
  return null;
}

export function parseSceneParams(phase1ConfigText: string): Phase1SceneParams {
  const config = parsePhase1Config(phase1ConfigText);
  const q = new URLSearchParams(window.location.search);
  return {
    seed: intParam(q, "seed", 1) >>> 0,
    worldPages: intParam(q, "world", config.runtime.screenshotWorldPages),
    terrainGrid: intParam(q, "terrainGrid", config.world.baseGrid, [1024, 2048, 4096]),
    debugMode: normalizePhase1DebugMode(q.get("terrainDebug"), config),
    freeze: q.get("freeze") === "1",
    hud: q.get("hud") === "1",
    dpr: numParam(q, "dpr"),
    cam: q.get("cam"),
    coastGui: q.get("coastGui") === "1",
  };
}
