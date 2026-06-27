import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
  borderOceanCameraForWorld,
  parseBorderOceanSceneConfig,
  validateBorderOceanStats,
} from "../src/debug/border_ocean_scene.js";

interface VisualPreset {
  name: string;
  renderer: "webgl" | "webgpu";
  weather: string;
  extra: readonly string[];
}

interface DiffStats {
  mean: number;
  p95: number;
}

const OUT_DIR = "shots/border-ocean/visual";
const WORLD_PAGES = 16;
const WORLD_CELLS = WORLD_PAGES * 4 * 16;
const CONFIG_TEXT = readFileSync("config/border_ocean_scene.yaml", "utf8");
const SCENE_CONFIG = parseBorderOceanSceneConfig(CONFIG_TEXT);
const CAMERA = borderOceanCameraForWorld(WORLD_CELLS, SCENE_CONFIG);
const CAMERA_ARG = `${CAMERA.eye[0].toFixed(0)},${CAMERA.eye[1].toFixed(0)},${CAMERA.eye[2].toFixed(0)},${CAMERA.look[0].toFixed(0)},${CAMERA.look[1].toFixed(0)},${CAMERA.look[2].toFixed(0)},${CAMERA.fov}`;

const PRESETS: readonly VisualPreset[] = [
  { name: "noon", renderer: "webgl", weather: "off", extra: [] },
  { name: "sunset", renderer: "webgl", weather: "off", extra: ["--sunElevationDeg", "8", "--sunAzimuthDeg", "238", "--hazeIntensity", "0.8"] },
  { name: "storm", renderer: "webgl", weather: "storm", extra: ["--weatherIntensity", "0.85", "--hazeIntensity", "1.0"] },
  { name: "cheap", renderer: "webgl", weather: "off", extra: ["--textureMipmaps", "0", "--grass", "0", "--trees", "0", "--stones", "0"] },
];

function run(label: string, args: string[]): void {
  console.log(`[border-ocean-visual] ${label}`);
  const result = spawnSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function shotArgs(preset: VisualPreset, out: string, stats: string): string[] {
  return [
    "run", "shoot", "--",
    "--scene", "border-ocean",
    "--renderer", preset.renderer,
    "--seed", "1",
    "--world", String(WORLD_PAGES),
    "--freeze", "1",
    "--hud", "1",
    "--framealign", "0",
    "--weather", preset.weather,
    "--cam", CAMERA_ARG,
    "--out", out,
    "--stats", stats,
    ...preset.extra,
  ];
}

function validateStatsFile(path: string): void {
  const stats = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  validateBorderOceanStats(stats, SCENE_CONFIG);
}

async function imageDiff(a: string, b: string): Promise<DiffStats> {
  const left = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(b).resize(left.info.width, left.info.height).removeAlpha().raw().toBuffer();
  const values: number[] = [];
  const count = Math.min(left.data.length, right.length);
  let sum = 0;
  for (let i = 0; i < count; i += 3) {
    const d = (Math.abs(left.data[i] - right[i]) + Math.abs(left.data[i + 1] - right[i + 1]) + Math.abs(left.data[i + 2] - right[i + 2])) / 3;
    values.push(d);
    sum += d;
  }
  values.sort((x, y) => x - y);
  return {
    mean: values.length > 0 ? sum / values.length : 0,
    p95: values.length > 0 ? values[Math.floor(values.length * 0.95)] ?? 0 : 0,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const shots: Record<string, { image: string; stats: string }> = {};
  for (const preset of PRESETS) {
    const image = `${OUT_DIR}/${preset.name}-${preset.renderer}.png`;
    const stats = `${OUT_DIR}/${preset.name}-${preset.renderer}-stats.json`;
    run(`shoot ${preset.name} ${preset.renderer}`, shotArgs(preset, image, stats));
    validateStatsFile(stats);
    shots[`${preset.name}-${preset.renderer}`] = { image, stats };
  }

  const report: Record<string, unknown> = { status: "pass", shots };
  if (process.env["BORDER_OCEAN_VISUAL_WEBGPU"] === "1") {
    const image = `${OUT_DIR}/noon-webgpu.png`;
    const stats = `${OUT_DIR}/noon-webgpu-stats.json`;
    try {
      run("shoot noon webgpu", shotArgs({ name: "noon", renderer: "webgpu", weather: "off", extra: [] }, image, stats));
      validateStatsFile(stats);
      const diff = await imageDiff(shots["noon-webgl"].image, image);
      const maxMean = SCENE_CONFIG.acceptance.maxWebglWebgpuMeanDelta;
      const maxP95 = SCENE_CONFIG.acceptance.maxWebglWebgpuP95Delta;
      if (diff.mean > maxMean || diff.p95 > maxP95) {
        throw new Error(`visual renderer parity exceeded: mean=${diff.mean.toFixed(2)} p95=${diff.p95.toFixed(2)}`);
      }
      report["webgpuParity"] = { image, stats, diff, maxMean, maxP95 };
    } catch (error) {
      if (process.env["BORDER_OCEAN_REQUIRE_WEBGPU"] === "1") throw error;
      report["webgpuParity"] = { skipped: true, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const reportPath = `${OUT_DIR}/report.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (!existsSync(reportPath)) throw new Error("visual report was not written");
  console.log(`[border-ocean-visual] wrote ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error("[border-ocean-visual] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
