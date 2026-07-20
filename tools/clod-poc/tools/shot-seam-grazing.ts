// Grazing-angle capture along the near-page -> far hand-off (band edges and the
// LOD zigzag are worst when viewed along the seam, not head-on).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseCliArgs, resolveOutputPath, settleFrames, stringArg, withWaterHarness } from "./water-harness.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const origin = typeof args.url === "string" ? args.url : "http://127.0.0.1:5180/";
  const out = resolveOutputPath(stringArg(args, "out", "qa-runs/seam-grazing"));
  mkdirSync(out, { recursive: true });
  const url = `${origin}?scene=infinite-islands&seed=1&world=8&quality=ultra&renderPreset=ultra&materialTiers=1&toneMap=agx`;
  await withWaterHarness({ url, world: 8, width: 1600, height: 900 }, async ({ page }) => {
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
    // Low camera on a mid-height shoreline, looking almost parallel to the ground so
    // the page->far transition band sweeps across the frame at a grazing angle.
    await page.evaluate(`(() => {
      const probe = window.waterProbe;
      let spot = { x: 2048, z: 2048, y: -Infinity };
      for (let z = 512; z < 3584; z += 48) {
        for (let x = 512; x < 3584; x += 48) {
          const y = probe(x, z).terrain;
          if (y > 30 && y < 60 && y > spot.y) spot = { x, z, y };
        }
      }
      window.__drusnielClod.setPose({ p: [spot.x, spot.y + 8, spot.z], yaw: Math.PI * 0.4, pitch: -0.03 });
    })()`);
    await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(300) : true");
    await settleFrames(page, 90);
    await page.evaluate(`[...document.body.children].forEach((el) => { if (el.tagName !== "CANVAS") el.style.visibility = "hidden"; })`);
    await page.screenshot(join(out, "agx-grazing.png"));
    console.log("[seam-grazing] captured", join(out, "agx-grazing.png"));
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
