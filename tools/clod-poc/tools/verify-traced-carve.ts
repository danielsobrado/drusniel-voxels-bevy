// Live verification for the W1 traced-channel terrain carve (infinite-islands).
//
// Boots the app (or attaches to --url), waits for ready, then reports:
//   1. startup `river_continuity_pct` / `river_continuity_channels`,
//   2. an in-page downstream walk from a strong river spot (wet fraction),
//   3. carved-bed evidence at the spot (terrain below water level in the core),
//   4. `webgpu_uncaptured_errors` and water clipmap counters,
// and captures aerial + close screenshots at the river spot.
//
// Usage:
//   npx tsx tools/verify-traced-carve.ts --url "http://127.0.0.1:5199/?scene=infinite-islands&seed=1&world=8" \
//     --out qa-runs/traced-carve-verify

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCliArgs,
  resolveOutputPath,
  setCameraPose,
  settleFrames,
  stringArg,
  withWaterHarness,
} from "./water-harness.js";

interface RiverSpot {
  x: number;
  z: number;
  depth: number;
  bodyMask: number;
  flowX: number;
  flowZ: number;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const url = typeof args.url === "string" ? args.url : undefined;
  const out = resolveOutputPath(stringArg(args, "out", "qa-runs/traced-carve-verify"));
  mkdirSync(out, { recursive: true });

  await withWaterHarness({ url, world: 8 }, async ({ page }) => {
    const waitReady = () => page.evaluate(`new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const clod = window.__drusnielClod;
        if (clod && clod.error) reject(new Error("boot failed: " + String(clod.error)));
        else if (clod && clod.ready) resolve(true);
        else if (Date.now() - t0 > 240000) reject(new Error("ready timeout"));
        else setTimeout(poll, 250);
      };
      poll();
    })`);
    await waitReady();
    // The app sometimes self-navigates once shortly after ready; settle and re-wait.
    await settleFrames(page, 30);
    await waitReady();

    const timings = await page.evaluate<Record<string, number>>("window.__drusnielStartupTimings ?? {}");
    const continuityPct = timings["river_continuity_pct"];
    const continuityChannels = timings["river_continuity_channels"];
    console.log(`river_continuity_pct: ${continuityPct}`);
    console.log(`river_continuity_channels: ${continuityChannels}`);

    const spot = await page.evaluate<RiverSpot | null>(`(() => {
      const probe = window.waterProbe;
      if (!probe) return null;
      let best = null;
      for (let z = 256; z < 4096; z += 24) {
        for (let x = 256; x < 4096; x += 24) {
          const s = probe(x, z);
          const flowLen = Math.hypot(s.flowX, s.flowZ);
          if (s.bodyMask < 0.9 || s.depth < 0.5 || flowLen < 0.5) continue;
          if (!best || s.depth > best.depth) {
            best = { x, z, depth: s.depth, bodyMask: s.bodyMask, flowX: s.flowX / flowLen, flowZ: s.flowZ / flowLen };
          }
        }
      }
      return best;
    })()`);
    if (!spot) throw new Error("no strong river spot found in the startup area");
    console.log(`river spot: (${spot.x}, ${spot.z}) depth=${spot.depth.toFixed(2)} mask=${spot.bodyMask.toFixed(2)}`);

    const walkFrom = (dir: 1 | -1) => page.evaluate<{ steps: number; wet: number; minDepth: number; maxDepth: number }>(`(() => {
      const probe = window.waterProbe;
      let x = ${spot.x};
      let z = ${spot.z};
      let s = probe(x, z);
      let steps = 0;
      let wet = 0;
      let minDepth = Infinity;
      let maxDepth = 0;
      for (let i = 0; i < 60; i++) {
        const flowLen = Math.hypot(s.flowX, s.flowZ) || 1;
        x += (s.flowX / flowLen) * 12 * ${dir};
        z += (s.flowZ / flowLen) * 12 * ${dir};
        s = probe(x, z);
        if (s.bodyMask < 0.3) break;
        steps++;
        if (s.depth > 0.2) wet++;
        minDepth = Math.min(minDepth, s.depth);
        maxDepth = Math.max(maxDepth, s.depth);
      }
      return { steps, wet, minDepth, maxDepth };
    })()`);
    const down = await walkFrom(1);
    const up = await walkFrom(-1);
    const walk = {
      steps: down.steps + up.steps,
      wet: down.wet + up.wet,
      minDepth: Math.min(down.minDepth, up.minDepth),
      maxDepth: Math.max(down.maxDepth, up.maxDepth),
    };
    const wetPct = walk.steps > 0 ? (100 * walk.wet) / walk.steps : 0;
    console.log(
      `channel walk: ${walk.wet}/${walk.steps} wet (${wetPct.toFixed(1)}%; down ${down.wet}/${down.steps}, up ${up.wet}/${up.steps}), ` +
        `depth ${walk.minDepth.toFixed(2)}..${walk.maxDepth.toFixed(2)} m`,
    );

    // Cross-channel transect: proves the terrain authority carved a channel bed —
    // banks near the water level at the edges, bed metres below in the middle.
    const transect = await page.evaluate<Array<{ d: number; terrain: number; water: number; wet: number }>>(`(() => {
      const probe = window.waterProbe;
      const px = ${-spot.flowZ};
      const pz = ${spot.flowX};
      const out = [];
      for (let d = -48; d <= 48; d += 4) {
        const s = probe(${spot.x} + px * d, ${spot.z} + pz * d);
        out.push({ d, terrain: s.terrain, water: s.water, wet: s.bodyMask > 0.3 ? 1 : 0 });
      }
      return out;
    })()`);
    const bankTerrain = Math.max(transect[0]!.terrain, transect[transect.length - 1]!.terrain);
    const bedTerrain = Math.min(...transect.map((p) => p.terrain));
    console.log(`transect: bank ${bankTerrain.toFixed(2)} m, bed ${bedTerrain.toFixed(2)} m (carved ${(bankTerrain - bedTerrain).toFixed(2)} m)`);
    console.log(transect.map((p) => `${p.d}:${p.terrain.toFixed(1)}${p.wet ? "~" : " "}`).join(" "));

    await settleFrames(page, 10);
    const counters = await page.evaluate<Record<string, number>>("window.__drusnielClod?.stats?.counters ?? {}");
    const uncaptured = counters["webgpu_uncaptured_errors"];
    const visibleLevels = counters["water_clipmap_visible_levels"];
    console.log(`webgpu_uncaptured_errors: ${uncaptured}`);
    console.log(`water_clipmap_visible_levels: ${visibleLevels}`);

    // __drusnielClod.setPose recenters streaming/vegetation around the new camera;
    // the water-debug pose hook does not, which leaves half-streamed terrain in shots.
    const teleport = async (x: number, z: number, y: number, yaw: number, pitch: number) => {
      const moved = await page.evaluate<boolean>(
        `(() => { const clod = window.__drusnielClod; if (!clod?.setPose) return false; clod.setPose({ p: [${x}, ${y}, ${z}], yaw: ${yaw}, pitch: ${pitch} }); return true; })()`,
      );
      if (!moved) await setCameraPose(page, { x, z, y, yaw, pitch, distance: 40 });
      await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(240) : true");
      await settleFrames(page, 60);
    };
    const terrainAt = (x: number, z: number) => page.evaluate<number>(`window.waterProbe(${x}, ${z}).terrain`);
    // Three.js YXZ yaw: camera forward is (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)).
    const yaw = Math.atan2(-spot.flowX, -spot.flowZ);
    const closeY = (await terrainAt(spot.x - spot.flowX * 70, spot.z - spot.flowZ * 70)) + 20;
    await teleport(spot.x - spot.flowX * 70, spot.z - spot.flowZ * 70, closeY, yaw, -0.3);
    await page.screenshot(join(out, "river-close.png"));
    const aerialY = (await terrainAt(spot.x, spot.z)) + 460;
    await teleport(spot.x, spot.z, aerialY, yaw, -1.55);
    await page.screenshot(join(out, "river-aerial.png"));

    const report = {
      url,
      spot,
      continuityPct,
      continuityChannels,
      walk: { ...walk, wetPct },
      counters: {
        webgpu_uncaptured_errors: uncaptured,
        water_clipmap_visible_levels: visibleLevels,
        water_clipmap_level_count: counters["water_clipmap_level_count"],
        water_clipmap_field_samples: counters["water_clipmap_field_samples"],
      },
    };
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(`report: ${join(out, "report.json")}`);

    const failures: string[] = [];
    if (!(continuityPct >= 95)) failures.push(`river_continuity_pct ${continuityPct} < 95`);
    if (!(wetPct >= 95)) failures.push(`downstream wet ${wetPct.toFixed(1)}% < 95%`);
    if (uncaptured !== 0) failures.push(`webgpu_uncaptured_errors ${uncaptured} != 0`);
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join("; ")}`);
      process.exitCode = 1;
    } else {
      console.log("PASS");
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
