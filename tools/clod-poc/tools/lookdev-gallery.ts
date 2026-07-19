// L0 lookdev gallery (reference-look plan, docs/plans/reference-look-terrain-atmosphere-2026-07-19.md).
//
// Boots infinite-islands in the lookdev profile — postprocess quality "ultra"
// (renderScale 1, TAA, clouds, GTAO, froxels, bounce, volumetric god rays), render
// resolution "ultra", material tiers ON, HQ water — and captures a deterministic pose
// battery per tonemap variant (agx and aces), with the DOM UI hidden. Poses are found
// by probing the live hydrology/terrain field, so the battery follows the world across
// seed or generator changes instead of pinning coordinates.
//
// Usage:
//   npx tsx tools/lookdev-gallery.ts --url "http://127.0.0.1:5199/" --out qa-runs/lookdev-2026-07-19
//
// Output: <out>/<variant>-<pose>.png + gallery.md index.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCliArgs,
  resolveOutputPath,
  settleFrames,
  stringArg,
  withWaterHarness,
} from "./water-harness.js";

const TONEMAP_VARIANTS = ["agx", "aces"] as const;

const LOOKDEV_PARAMS: Record<string, string> = {
  scene: "infinite-islands",
  seed: "1",
  world: "8",
  quality: "ultra",
  renderPreset: "ultra",
  materialTiers: "1",
};

interface Pose {
  name: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  pitch: number;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const origin = typeof args.url === "string" ? args.url : "http://127.0.0.1:5180/";
  const out = resolveOutputPath(stringArg(args, "out", `qa-runs/lookdev-${new Date().toISOString().slice(0, 10)}`));
  mkdirSync(out, { recursive: true });
  const captured: Array<{ variant: string; pose: string; file: string }> = [];

  for (const variant of TONEMAP_VARIANTS) {
    const url = new URL(origin);
    for (const [key, value] of Object.entries(LOOKDEV_PARAMS)) url.searchParams.set(key, value);
    url.searchParams.set("toneMap", variant);
    console.log(`[lookdev] boot ${variant}: ${url}`);

    await withWaterHarness({ url: url.toString(), world: 8, width: 1600, height: 900 }, async ({ page }) => {
      await page.evaluate(`new Promise((resolve, reject) => {
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
      await settleFrames(page, 30);

      const poses = await page.evaluate<Pose[]>(`(() => {
        const probe = window.waterProbe;
        const terrain = (x, z) => probe(x, z).terrain;
        const poses = [];

        // Strongest river spot: deepest wet flowing sample in the startup region.
        let spot = null;
        for (let z = 256; z < 4096; z += 24) {
          for (let x = 256; x < 4096; x += 24) {
            const s = probe(x, z);
            if (s.bodyMask < 0.9 || s.depth < 1 || Math.hypot(s.flowX, s.flowZ) < 0.5) continue;
            if (!spot || s.depth > spot.depth) {
              const len = Math.hypot(s.flowX, s.flowZ);
              spot = { x, z, depth: s.depth, fx: s.flowX / len, fz: s.flowZ / len };
            }
          }
        }
        if (spot) {
          const yaw = Math.atan2(-spot.fx, -spot.fz);
          poses.push({
            name: "river-close",
            x: spot.x - spot.fx * 70, z: spot.z - spot.fz * 70,
            y: terrain(spot.x - spot.fx * 70, spot.z - spot.fz * 70) + 18,
            yaw, pitch: -0.28,
          });
          poses.push({
            name: "river-aerial",
            x: spot.x, z: spot.z, y: terrain(spot.x, spot.z) + 420, yaw, pitch: -1.5,
          });
        }

        // Highest ridge in the region, looking across it toward the horizon.
        let ridge = { x: 1024, z: 1024, y: -Infinity };
        for (let z = 256; z < 4096; z += 48) {
          for (let x = 256; x < 4096; x += 48) {
            const y = terrain(x, z);
            if (y > ridge.y) ridge = { x, z, y };
          }
        }
        poses.push({ name: "ridge", x: ridge.x, z: ridge.z, y: ridge.y + 26, yaw: Math.PI * 0.75, pitch: -0.12 });

        // Coastline: deepest ocean point, then gradient-ascend to a shore vantage.
        let ocean = { x: 512, z: 512, y: Infinity };
        for (let z = 128; z < 4224; z += 48) {
          for (let x = 128; x < 4224; x += 48) {
            const y = terrain(x, z);
            if (y < ocean.y) ocean = { x, z, y };
          }
        }
        let sx = ocean.x, sz = ocean.z;
        for (let i = 0; i < 80 && terrain(sx, sz) < 23; i++) {
          const gx = terrain(sx + 12, sz) - terrain(sx - 12, sz);
          const gz = terrain(sx, sz + 12) - terrain(sx, sz - 12);
          const len = Math.hypot(gx, gz) || 1;
          sx += (gx / len) * 18; sz += (gz / len) * 18;
        }
        poses.push({
          name: "coast",
          x: sx, z: sz, y: terrain(sx, sz) + 14,
          yaw: Math.atan2(-(ocean.x - sx), -(ocean.z - sz)), pitch: -0.14,
        });

        // Mid-height valley vantage: lowest inland point above sea level, looking along it.
        let valley = { x: 1024, z: 1024, y: Infinity };
        for (let z = 512; z < 3840; z += 48) {
          for (let x = 512; x < 3840; x += 48) {
            const y = terrain(x, z);
            if (y > 22 && y < valley.y) valley = { x, z, y };
          }
        }
        poses.push({ name: "valley", x: valley.x, z: valley.z, y: valley.y + 22, yaw: Math.PI * 0.25, pitch: -0.2 });

        return poses;
      })()`);
      console.log(`[lookdev] ${variant}: ${poses.length} poses (${poses.map((pose) => pose.name).join(", ")})`);

      for (const pose of poses) {
        const moved = await page.evaluate<boolean>(
          `(() => { const clod = window.__drusnielClod; if (!clod?.setPose) return false; clod.setPose({ p: [${pose.x}, ${pose.y}, ${pose.z}], yaw: ${pose.yaw}, pitch: ${pose.pitch} }); return true; })()`,
        );
        if (!moved) throw new Error("__drusnielClod.setPose unavailable");
        await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(300) : true");
        await settleFrames(page, 90);
        // Hide DOM UI so the gallery judges the render, not the tooling.
        await page.evaluate(`[...document.body.children].forEach((el) => { if (el.tagName !== "CANVAS") el.style.visibility = "hidden"; })`);
        const file = `${variant}-${pose.name}.png`;
        await page.screenshot(join(out, file));
        await page.evaluate(`[...document.body.children].forEach((el) => { el.style.visibility = ""; })`);
        captured.push({ variant, pose: pose.name, file });
        console.log(`[lookdev] captured ${file}`);
      }
    });
  }

  const poseNames = [...new Set(captured.map((entry) => entry.pose))];
  const lines = [
    "# Lookdev gallery",
    "",
    `Profile: ${Object.entries(LOOKDEV_PARAMS).map(([key, value]) => `${key}=${value}`).join(" ")}`,
    "",
    "| pose | " + TONEMAP_VARIANTS.map((variant) => `toneMap=${variant}`).join(" | ") + " |",
    "| --- | " + TONEMAP_VARIANTS.map(() => "---").join(" | ") + " |",
    ...poseNames.map((pose) =>
      `| ${pose} | ` + TONEMAP_VARIANTS.map((variant) => `![${variant}-${pose}](${variant}-${pose}.png)`).join(" | ") + " |",
    ),
    "",
  ];
  writeFileSync(join(out, "gallery.md"), lines.join("\n"));
  console.log(`[lookdev] gallery: ${join(out, "gallery.md")} (${captured.length} shots)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
