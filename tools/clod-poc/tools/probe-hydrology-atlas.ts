// Streaming hydrology atlas (Phase 4b) browser probe.
//
// Verifies against a live infinite-islands scene that the GPU vegetation hydrology atlas
// activates, fills its tile window from the build worker, and re-fills after the camera
// leaves the startup world. Counters come from the vegetation frame phase mirror
// (hydrology_atlas_* in window.__drusnielClod.stats.counters, 30-frame cadence).
//
//   npx tsx tools/probe-hydrology-atlas.ts --url "http://127.0.0.1:5180/" [--timeout 120]
//
// Exit code 1 when the atlas never activates or never fills its window.
import { settleFrames, numberArg, parseCliArgs, stringArg, withWaterHarness, type WaterHarness } from "./water-harness.js";

interface AtlasCounters {
  active: number;
  filledTiles: number;
  totalTiles: number;
  recenters: number;
  uploads: number;
  cameraOutsideStartup: number;
}

const DEFAULT_URL =
  "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&hud=1&clodPerf=1&webgpuSelection=1" +
  "&farClipmap=1&farClipmapMode=replace&farClipmapShaderDisplacement=1&cam=1824,60,1780,3.1,-0.5,55&x=1824&z=1696";

async function readCounters(harness: WaterHarness): Promise<AtlasCounters | null> {
  const raw = await harness.page
    .evaluate<Record<string, number> | null>(
      "(window.__drusnielClod && window.__drusnielClod.stats && window.__drusnielClod.stats.counters) || null",
    )
    .catch(() => null);
  if (!raw) return null;
  return {
    active: Number(raw["hydrology_atlas_active"] ?? 0),
    filledTiles: Number(raw["hydrology_atlas_filled_tiles"] ?? 0),
    totalTiles: Number(raw["hydrology_atlas_total_tiles"] ?? 0),
    recenters: Number(raw["hydrology_atlas_recenters"] ?? 0),
    uploads: Number(raw["hydrology_atlas_uploads"] ?? 0),
    cameraOutsideStartup: Number(raw["infinite_hydrology_camera_outside_startup"] ?? 0),
  };
}

async function waitForFill(harness: WaterHarness, deadline: number, label: string): Promise<AtlasCounters> {
  let last: AtlasCounters | null = null;
  while (Date.now() < deadline) {
    const counters = await readCounters(harness);
    if (counters) {
      last = counters;
      if (counters.active === 1 && counters.totalTiles > 0 && counters.filledTiles >= counters.totalTiles) {
        return counters;
      }
    }
    await settleFrames(harness.page, 30);
  }
  throw new Error(
    `${label}: atlas did not fill in time (last: ${last ? JSON.stringify(last) : "no counters"})`,
  );
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const url = stringArg(args, "url", DEFAULT_URL).startsWith("http")
    ? stringArg(args, "url", DEFAULT_URL)
    : DEFAULT_URL;
  const fullUrl = url.includes("scene=") ? url : DEFAULT_URL.replace("http://127.0.0.1:5180/", url.endsWith("/") ? url : `${url}/`);
  const timeoutMs = numberArg(args, "timeout", 120) * 1000;

  await withWaterHarness({ url: fullUrl }, async (harness) => {
    // The infinite-islands spawn pose sits outside the startup world, so a full window
    // here already exercises the outside-world tile path end to end (worker builds →
    // CPU blits → GPU uploads). Camera teleports cannot exercise recentering: in orbit
    // mode the canonical world center is pinned to the spawned player by design
    // (terrain_frame_phase.ts canonicalWorldCenter); recenter/refill behaviour is
    // covered by hydrologyAtlas.test.ts instead.
    const bootDeadline = Date.now() + timeoutMs;
    const atSpawn = await waitForFill(harness, bootDeadline, "spawn");
    process.stdout.write(`spawn window filled: ${JSON.stringify(atSpawn)}\n`);
    if (atSpawn.uploads < atSpawn.totalTiles) {
      throw new Error(`expected at least ${atSpawn.totalTiles} tile uploads, saw ${atSpawn.uploads}`);
    }
    if (atSpawn.cameraOutsideStartup !== 1) {
      throw new Error("spawn pose unexpectedly inside the startup world; probe no longer covers the outside-world path");
    }
    process.stdout.write("hydrology atlas probe PASS\n");
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
