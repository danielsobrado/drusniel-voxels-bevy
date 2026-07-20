// Captures the same impostor-heavy forest pose in normal, age and competition modes.
//
// Usage:
//   npx tsx tools/tree-morphology-evidence.ts --url "http://127.0.0.1:5180/" --out qa-runs/tree-morphology-2026-07-20

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCliArgs,
  resolveOutputPath,
  settleFrames,
  stringArg,
  withWaterHarness,
} from "./water-harness.js";

const MODES = ["off", "age", "competition"] as const;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const origin = typeof args.url === "string" ? args.url : "http://127.0.0.1:5180/";
  const out = resolveOutputPath(stringArg(args, "out", `qa-runs/tree-morphology-${new Date().toISOString().slice(0, 10)}`));
  const x = Number(stringArg(args, "x", "2048"));
  const z = Number(stringArg(args, "z", "2048"));
  const yaw = Number(stringArg(args, "yaw", "2.65"));
  const pitch = Number(stringArg(args, "pitch", "-0.18"));
  mkdirSync(out, { recursive: true });

  for (const mode of MODES) {
    const url = new URL(origin);
    url.searchParams.set("scene", "infinite-islands");
    url.searchParams.set("seed", "1");
    url.searchParams.set("world", "8");
    url.searchParams.set("quality", "ultra");
    url.searchParams.set("renderPreset", "ultra");
    url.searchParams.set("materialTiers", "1");
    if (mode !== "off") url.searchParams.set("treeMorphologyEvidence", mode);

    await withWaterHarness({ url: url.toString(), world: 8, width: 1600, height: 900 }, async ({ page }) => {
      await page.evaluate(`new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
          const runtime = window.__drusnielClod;
          if (runtime?.error) reject(new Error(String(runtime.error)));
          else if (runtime?.ready) resolve(true);
          else if (Date.now() - started > 240000) reject(new Error("ready timeout"));
          else setTimeout(poll, 250);
        };
        poll();
      })`);
      await settleFrames(page, 60);
      const terrainY = await page.evaluate<number>(`window.waterProbe(${x}, ${z}).terrain`);
      const moved = await page.evaluate<boolean>(`(() => {
        const runtime = window.__drusnielClod;
        if (!runtime?.setPose) return false;
        runtime.setPose({ p: [${x}, ${terrainY + 18}, ${z}], yaw: ${yaw}, pitch: ${pitch} });
        return true;
      })()`);
      if (!moved) throw new Error("__drusnielClod.setPose unavailable");
      await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(300) : true");
      await settleFrames(page, 120);
      await page.evaluate(`[...document.body.children].forEach((element) => { if (element.tagName !== "CANVAS") element.style.visibility = "hidden"; })`);
      await page.screenshot(join(out, `${mode}.png`));
    });
  }

  writeFileSync(join(out, "gallery.md"), [
    "# Tree morphology evidence",
    "",
    "| normal | age | competition |",
    "| --- | --- | --- |",
    "| ![normal](off.png) | ![age](age.png) | ![competition](competition.png) |",
    "",
    "Age mode maps young → green, mature → amber and old → red. Competition maps open-grown → green and crowded → red.",
    "",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
