import { PHASE0 } from "./constants.js";
import type { CamPose } from "./hooks.js";

export type RendererParam = "webgpu" | "webgl";

export interface ClodParams {
  seed: number;
  scene: string;
  cam: string | null;
  hud: boolean;
  freeze: boolean;
  dpr: number | null;
  renderer: RendererParam;
  shot: number | null;
}

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseClodParams(search = window.location.search): ClodParams {
  const q = new URLSearchParams(search);
  const rendererRaw = q.get("renderer");
  const shot = num(q.get("shot"), 0);
  return {
    seed: Math.floor(num(q.get("seed"), PHASE0.defaultSeed)) >>> 0,
    scene: q.get("scene") ?? PHASE0.defaultScene,
    cam: q.get("cam"),
    hud: q.get("hud") === "1",
    freeze: q.get("freeze") === "1",
    dpr: q.get("dpr") !== null ? Math.max(0.1, num(q.get("dpr"), 1)) : null,
    renderer: rendererRaw === "webgl" ? "webgl" : "webgpu",
    shot: shot > 0 ? Math.floor(shot) : null,
  };
}

export function parseCamString(cam: string): CamPose | null {
  const parts = cam.split(",").map(Number);
  if (parts.length < 5 || parts.some((v) => !Number.isFinite(v))) return null;
  const [px, py, pz, yaw, pitch, fov] = parts as [number, number, number, number, number, number?];
  const pose: CamPose = { p: [px, py, pz], yaw, pitch };
  if (fov !== undefined && Number.isFinite(fov)) pose.fov = fov;
  return pose;
}
