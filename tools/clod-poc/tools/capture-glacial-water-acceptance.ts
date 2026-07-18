import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  numberArg,
  parseCliArgs,
  resolveOutputPath,
  setCameraPose,
  setWaterDebugMode,
  settleFrames,
  stringArg,
  waterDebugInfo,
  withWaterHarness,
  type CdpPage,
} from "./water-harness.js";
import {
  GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES,
  GLACIAL_WATER_CAPTURE_PROFILES,
  cameraPoseMatches,
  captureFileName,
  glacialWaterProfileUrl,
  type GlacialWaterCaptureProfile,
  type GlacialWaterCaptureProfileConfig,
} from "./glacial-water-acceptance-config.js";
import {
  findWaterShotPose,
  parseWaterShotDebugModes,
  type WaterShotCandidatePose,
  type WaterShotDebugMode,
  type WaterShotScene,
} from "./water-shot-scenes.js";

interface CapturedSceneManifest {
  scene: WaterShotScene;
  pose: WaterShotCandidatePose;
  files: string[];
}

interface CapturedProfileManifest {
  profile: GlacialWaterCaptureProfile;
  url: string;
  query: Readonly<Record<string, string>>;
  worldCells: number;
  scenes: CapturedSceneManifest[];
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const seed = stringArg(args, "seed", "1");
  const sourceUrl = typeof args.url === "string" ? args.url : undefined;
  const outRoot = resolveOutputPath(stringArg(args, "out", "shots/water/glacial-acceptance"));
  const modes = resolveDebugModes(stringArg(args, "debug", "acceptance"));
  const profiles = resolveProfiles(stringArg(args, "profile", "all"));
  const baselinePoses = new Map<WaterShotScene, WaterShotCandidatePose>();
  const profileManifests: CapturedProfileManifest[] = [];

  mkdirSync(outRoot, { recursive: true });
  await withWaterHarness({ url: sourceUrl, world }, async ({ page, url: baseUrl }) => {
    for (const profileName of profiles) {
      const profile = GLACIAL_WATER_CAPTURE_PROFILES[profileName];
      const profileUrl = withSeed(glacialWaterProfileUrl(baseUrl, profile), seed);
      await navigateToProfile(page, profileUrl);
      const info = await waterDebugInfo(page);
      assertDebugModesAvailable(info.debugModes, modes);
      const profileOut = join(outRoot, profile.name);
      mkdirSync(profileOut, { recursive: true });
      const capturedScenes: CapturedSceneManifest[] = [];

      for (const scene of profile.scenes) {
        const pose = await resolvePose(page, scene, info.worldCells, profile, baselinePoses);
        await setCameraPose(page, pose);
        const sceneOut = join(profileOut, scene);
        mkdirSync(sceneOut, { recursive: true });
        const files: string[] = [];
        for (const mode of modes) {
          await setWaterDebugMode(page, mode);
          const file = captureFileName(mode);
          await page.screenshot(join(sceneOut, file));
          files.push(file);
        }
        capturedScenes.push({ scene, pose, files });
        console.log(`${profile.name}/${scene}: ${sceneOut}`);
      }

      profileManifests.push({
        profile: profile.name,
        url: profileUrl,
        query: profile.query,
        worldCells: info.worldCells,
        scenes: capturedScenes,
      });
    }
  });

  const cameraParity = buildCameraParity(profileManifests);
  const manifest = {
    schemaVersion: 1,
    seed,
    world,
    debugModes: modes,
    profiles: profileManifests,
    cameraParity,
  };
  const manifestPath = join(outRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`manifest: ${manifestPath}`);
}

function resolveDebugModes(value: string): WaterShotDebugMode[] {
  if (value === "acceptance") return [...GLACIAL_WATER_ACCEPTANCE_DEBUG_MODES];
  return value.split(",").flatMap((entry) => parseWaterShotDebugModes(entry.trim()));
}

function resolveProfiles(value: string): GlacialWaterCaptureProfile[] {
  if (value === "all") return ["baseline", "glacial", "glacial-low-sun"];
  if (value === "ab") return ["baseline", "glacial"];
  if (value === "baseline" || value === "glacial" || value === "glacial-low-sun") return [value];
  throw new Error("--profile must be all, ab, baseline, glacial, or glacial-low-sun");
}

async function resolvePose(
  page: CdpPage,
  scene: WaterShotScene,
  worldCells: number,
  profile: GlacialWaterCaptureProfileConfig,
  baselinePoses: Map<WaterShotScene, WaterShotCandidatePose>,
): Promise<WaterShotCandidatePose> {
  if (profile.name === "glacial") {
    const baseline = baselinePoses.get(scene);
    if (baseline) return baseline;
  }

  const pose = await findWaterShotPose(page, scene, worldCells);
  if (profile.name === "baseline") baselinePoses.set(scene, pose);
  return pose;
}

async function navigateToProfile(page: CdpPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate<boolean>(
      `location.href === ${JSON.stringify(url)} && typeof window.waterProbe === "function" && typeof window.setWaterDebugMode === "function" && typeof window.setCameraPose === "function" && typeof window.waterDebugInfo === "function"`,
    ).catch(() => false);
    if (ready) {
      await settleFrames(page, 12);
      return;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for water debug API after navigating to ${url}`);
}

function assertDebugModesAvailable(
  available: Readonly<Record<string, number>>,
  requested: readonly WaterShotDebugMode[],
): void {
  const missing = requested.filter((mode) => !(mode in available));
  if (missing.length > 0) throw new Error(`water debug API is missing modes: ${missing.join(", ")}`);
}

function buildCameraParity(profiles: readonly CapturedProfileManifest[]): Record<string, boolean> {
  const baseline = profiles.find((profile) => profile.profile === "baseline");
  const glacial = profiles.find((profile) => profile.profile === "glacial");
  if (!baseline || !glacial) return {};

  const result: Record<string, boolean> = {};
  for (const baselineScene of baseline.scenes) {
    const glacialScene = glacial.scenes.find((entry) => entry.scene === baselineScene.scene);
    const matches = Boolean(glacialScene && cameraPoseMatches(baselineScene.pose, glacialScene.pose));
    result[baselineScene.scene] = matches;
    if (!matches) throw new Error(`baseline/glacial camera pose drifted for ${baselineScene.scene}`);
  }
  return result;
}

function withSeed(input: string, seed: string): string {
  const url = new URL(input);
  url.searchParams.set("seed", seed);
  return url.toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
