import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  setCameraPose,
  setWaterDebugMode,
  stringArg,
  waterDebugInfo,
  withWaterHarness,
  type CameraPoseArgs,
} from "./water-harness.js";
import {
  GLACIAL_WATER_SHOT_SCENES,
  STANDARD_WATER_SHOT_SCENES,
  WATER_SHOT_DEBUG_MODES,
  findWaterShotPose,
  parseWaterShotDebugModes,
  parseWaterShotScene,
  type WaterShotScene,
} from "./water-shot-scenes.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const seed = stringArg(args, "seed", "");
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const url = typeof args.url === "string" ? args.url : undefined;
  const sceneArg = stringArg(args, "scene", "single");
  const scenes = parseScenes(sceneArg);
  const modes = parseWaterShotDebugModes(stringArg(args, "debug", "all"));
  const stamp = seed ? `seed-${seed}` : new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = resolveOutputPath(stringArg(args, "out", `shots/water/${stamp}`));
  const explicitPose = explicitCameraPose(args);

  await withWaterHarness({ url, world }, async ({ page, url: appUrl }) => {
    const info = await waterDebugInfo(page);
    const missingModes = modes.filter((mode) => !(mode in info.debugModes));
    if (missingModes.length > 0) throw new Error(`water debug API is missing modes: ${missingModes.join(", ")}`);
    mkdirSync(outRoot, { recursive: true });
    const manifest: Record<string, unknown> = {
      appUrl,
      worldCells: info.worldCells,
      seed: seed || null,
      debugModes: WATER_SHOT_DEBUG_MODES,
      scenes: [],
    };

    for (const scene of scenes) {
      const sceneOut = scenes.length === 1 && scene === "single" ? outRoot : join(outRoot, scene);
      mkdirSync(sceneOut, { recursive: true });
      const pose = explicitPose ?? await findWaterShotPose(page, scene, info.worldCells);
      if (scene === "clipmap-boundary") {
        await setCameraPose(page, { ...pose, x: pose.x - 3, z: pose.z - 3 });
      }
      await setCameraPose(page, pose);

      const files: string[] = [];
      for (const mode of modes) {
        await setWaterDebugMode(page, mode);
        const file = mode === "clipmapLevel" ? "clipmap-level.png" : mode === "ssrHit" ? "ssr-hit.png" : `${mode}.png`;
        await page.screenshot(join(sceneOut, file));
        files.push(file);
      }
      (manifest.scenes as unknown[]).push({ scene, pose, files });
      console.log(`${scene}: ${sceneOut}`);
      for (const file of files) console.log(`  ${file}`);
    }

    writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`manifest: ${join(outRoot, "manifest.json")}`);
  });
}

function explicitCameraPose(args: Record<string, string | boolean>): CameraPoseArgs | null {
  if (typeof args.x !== "string" && typeof args.z !== "string") return null;
  return {
    x: numberArg(args, "x", 0),
    z: numberArg(args, "z", 0),
    yaw: numberArg(args, "yaw", 0),
    y: typeof args.y === "string" ? numberArg(args, "y", 0) : undefined,
    distance: numberArg(args, "distance", 26),
    pitch: numberArg(args, "pitch", -0.35),
  };
}

function parseScenes(value: string): WaterShotScene[] {
  if (value === "all") return [...STANDARD_WATER_SHOT_SCENES];
  if (value === "glacial") return [...GLACIAL_WATER_SHOT_SCENES, "low-sun-glitter"];
  return [parseWaterShotScene(value)];
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
