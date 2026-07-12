// Temporary Phase 7b visual check: river close-up with per-body presets + RGB
// absorption + shore-distance foam, for both TSL material paths. Deleted after use.
import { mkdirSync } from "node:fs";
import { setCameraPose, setWaterDebugMode, settleFrames, withWaterHarness } from "./water-harness.js";

const BASE =
  "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&hud=0&clodPerf=1&webgpuSelection=1" +
  "&farClipmap=1&farClipmapMode=replace&farClipmapShaderDisplacement=1" +
  "&cam=1824,60,1780,3.1,-0.5,55&x=1824&z=1696&water=1";

async function capture(url: string, tag: string, foamShot: boolean): Promise<void> {
  await withWaterHarness({ url }, async (harness) => {
    for (let i = 0; i < 70; i++) await settleFrames(harness.page, 30);
    const err = await harness.page
      .evaluate<string | null>("(window.__drusnielClod && window.__drusnielClod.error) || null")
      .catch(() => "hook read failed");
    if (err) throw new Error(`${tag}: fail-loud boot error: ${err}`);
    await setCameraPose(harness.page, { x: 1824, z: 1696, yaw: 0.8, distance: 34, pitch: -0.65 });
    await settleFrames(harness.page, 30);
    await harness.page.screenshot(`shots/water-7b/${tag}-lit.png`);
    if (foamShot) {
      await setWaterDebugMode(harness.page, "foam");
      await settleFrames(harness.page, 8);
      await harness.page.screenshot(`shots/water-7b/${tag}-foam.png`);
      await setWaterDebugMode(harness.page, "final");
    }
    // Deep/open water pose: hunt the nearest sample with real depth so lake/river
    // interiors (far from any shoreline) are also visually verified.
    const deep = await harness.page.evaluate<{ x: number; z: number; depth: number } | null>(`(() => {
      let best = null;
      for (let dz = -800; dz <= 800; dz += 40) {
        for (let dx = -800; dx <= 800; dx += 40) {
          const x = 1824 + dx, z = 1696 + dz;
          const p = window.waterProbe(x, z);
          if (p.depth > 2.5 && p.bodyMask > 0.5) {
            const d2 = dx * dx + dz * dz;
            if (!best || d2 < best.d2) best = { x, z, depth: p.depth, d2 };
          }
        }
      }
      return best ? { x: best.x, z: best.z, depth: best.depth } : null;
    })()`);
    if (deep) {
      process.stdout.write(`${tag}: deep spot x=${deep.x} z=${deep.z} depth=${deep.depth.toFixed(2)}\n`);
      await setCameraPose(harness.page, { x: deep.x, z: deep.z, yaw: 2.4, distance: 40, pitch: -0.6 });
      await settleFrames(harness.page, 30);
      await harness.page.screenshot(`shots/water-7b/${tag}-deep.png`);
    } else {
      process.stdout.write(`${tag}: no deep water within 800m\n`);
    }
    process.stdout.write(`${tag}: captured\n`);
  });
}

async function main(): Promise<void> {
  mkdirSync("shots/water-7b", { recursive: true });
  await capture(`${BASE}&waterHq=1`, "hq", true);
  await capture(BASE, "perf", false);
  process.stdout.write("7b shots done\n");
}

main().catch((error) => {
  process.stderr.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
