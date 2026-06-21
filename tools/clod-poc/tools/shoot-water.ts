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

type WaterScene = "single" | "lake-shoreline" | "river-bend" | "dry-to-water-crossing" | "clipmap-boundary";

interface CandidatePose extends CameraPoseArgs {
  depth: number;
  wetFraction: number;
  kind: "lake" | "river";
}

const DEBUG_MODES = ["final", "depth", "foam", "fresnel", "flow", "clipmapLevel"] as const;
const SCENES: WaterScene[] = ["lake-shoreline", "river-bend", "dry-to-water-crossing", "clipmap-boundary"];

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const seed = stringArg(args, "seed", "");
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const url = typeof args.url === "string" ? args.url : undefined;
  const sceneArg = stringArg(args, "scene", "single");
  const scenes = sceneArg === "all" ? SCENES : [parseScene(sceneArg)];
  const modes = parseDebugModes(stringArg(args, "debug", "all"));
  const stamp = seed ? `seed-${seed}` : new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = resolveOutputPath(stringArg(args, "out", `shots/water/${stamp}`));
  const explicitPose = explicitCameraPose(args);

  await withWaterHarness({ url, world }, async ({ page, url: appUrl }) => {
    const info = await waterDebugInfo(page);
    mkdirSync(outRoot, { recursive: true });
    const manifest: Record<string, unknown> = {
      appUrl,
      worldCells: info.worldCells,
      seed: seed || null,
      scenes: [],
    };

    for (const scene of scenes) {
      const sceneOut = scenes.length === 1 && scene === "single" ? outRoot : join(outRoot, scene);
      mkdirSync(sceneOut, { recursive: true });
      const pose = explicitPose ?? await findScenePose(page, scene, info.worldCells);
      if (scene === "clipmap-boundary") {
        await setCameraPose(page, { ...pose, x: pose.x - 3, z: pose.z - 3 });
      }
      await setCameraPose(page, pose);

      const files: string[] = [];
      for (const mode of modes) {
        await setWaterDebugMode(page, mode);
        const file = `${mode === "clipmapLevel" ? "clipmap-level" : mode}.png`;
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

function parseScene(value: string): WaterScene {
  if (value === "single" || value === "lake-shoreline" || value === "river-bend" || value === "dry-to-water-crossing" || value === "clipmap-boundary") {
    return value;
  }
  throw new Error(`unknown --scene ${value}; expected single, all, lake-shoreline, river-bend, dry-to-water-crossing, or clipmap-boundary`);
}

function parseDebugModes(value: string): typeof DEBUG_MODES[number][] {
  if (value === "all") return [...DEBUG_MODES];
  const normalized = value === "clipmap-level" ? "clipmapLevel" : value;
  if (DEBUG_MODES.includes(normalized as typeof DEBUG_MODES[number])) return [normalized as typeof DEBUG_MODES[number]];
  throw new Error(`unknown --debug ${value}; expected all, final, depth, foam, fresnel, flow, or clipmap-level`);
}

async function findScenePose(page: { evaluate<T>(expression: string): Promise<T> }, scene: WaterScene, worldCells: number): Promise<CandidatePose> {
  const preferKind = scene === "river-bend" ? "river" : scene === "lake-shoreline" ? "lake" : "any";
  const preferCrossing = scene === "dry-to-water-crossing";
  const pose = await page.evaluate<CandidatePose | null>(`(() => {
    const worldCells = ${worldCells};
    const preferKind = ${JSON.stringify(preferKind)};
    const preferCrossing = ${preferCrossing};
    const probe = window.waterProbe;
    const dirs = Array.from({ length: 24 }, (_, i) => {
      const a = i / 24 * Math.PI * 2;
      return [Math.cos(a), Math.sin(a)];
    });
    const wetFraction = (x, z) => {
      let wet = 0;
      let total = 0;
      for (let dz = -8; dz <= 8; dz += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          const px = x + dx;
          const pz = z + dz;
          if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
          const s = probe(px, pz);
          total += 1;
          if (s.depth > 0.02 && s.bodyMask > 0.05) wet += 1;
        }
      }
      return total > 0 ? wet / total : 0;
    };
    const nearestBank = (x, z) => {
      let best = null;
      for (const [dx, dz] of dirs) {
        for (let r = 5; r <= 14; r += 1) {
          const px = x + dx * r;
          const pz = z + dz * r;
          if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
          const s = probe(px, pz);
          if (s.depth <= 0 || s.bodyMask <= 0.02) {
            if (!best || r < best.distance) best = { distance: r, dx, dz };
            break;
          }
        }
      }
      return best;
    };
    let best = null;
    for (let z = 0; z <= worldCells; z += 2) {
      for (let x = 0; x <= worldCells; x += 2) {
        const s = probe(x, z);
        if (s.depth < 0.08 || s.depth > 0.7 || s.bodyMask <= 0.05) continue;
        const kind = s.flowSpeed > 0.001 ? "river" : "lake";
        if (preferKind !== "any" && kind !== preferKind) continue;
        const bank = nearestBank(x, z);
        if (!bank) continue;
        const wet = wetFraction(x, z);
        if (wet < 0.25) continue;
        const viewX = -bank.dx;
        const viewZ = -bank.dz;
        const yaw = Math.atan2(viewX, -viewZ);
        const depthScore = 1 - Math.min(1, Math.abs(s.depth - 0.32) / 0.38);
        const crossingScore = preferCrossing ? Math.max(0, 1 - Math.abs(bank.distance - 7) / 7) : 0;
        const score = wet * 2 + depthScore + crossingScore + (kind === "river" ? 0.1 : 0);
        if (!best || score > best.score) best = { x, z, yaw, depth: s.depth, wetFraction: wet, kind, score };
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, yaw: best.yaw, distance: 26, pitch: -0.35, depth: best.depth, wetFraction: best.wetFraction, kind: best.kind };
  })()`);
  if (!pose) throw new Error(`could not find a ${scene} water shot`);
  return pose;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
