// Temporary diagnostic: compare far-summary provider heights vs near-field truth
// in the CLOD fallback ring (inside the far-clipmap inner radius).
import { withWaterHarness } from "./water-harness.js";

async function main(): Promise<void> {
  const url = "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&world=8&quality=ultra&renderPreset=ultra&materialTiers=1";
  await withWaterHarness({ url, world: 8, width: 640, height: 360 }, async ({ page }) => {
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
    const report = await page.evaluate(`(() => {
      const integ = window.__drusnielFarSummary;
      if (!integ) return { error: "no __drusnielFarSummary" };
      const provider = integ.getHeightProvider();
      if (!provider) return { error: "no provider" };
      const pose = window.__drusnielClod.getPose ? window.__drusnielClod.getPose() : null;
      const cx = pose ? pose.p[0] : 2048, cz = pose ? pose.p[2] : 2048;
      const rows = [];
      let maxTruth = { h: -Infinity };
      // Find the highest true-land points at far distances and compare summary heights.
      for (const d of [500, 900, 1400, 2000, 3000, 4000]) {
        let best = null;
        for (let ang = 0; ang < 6.28; ang += 0.13) {
          const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
          const truth = window.waterProbe ? window.waterProbe(x, z).terrain : null;
          if (truth !== null && (!best || truth > best.truth)) best = { x, z, truth, d };
        }
        if (!best) continue;
        const h = provider.sampleHeight(best.x, best.z);
        const out = { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0, waterCoverage: 0, waterLevel: 0, bodyKind: 0, shoreDistance: 0, unifiedChannels: false };
        const ok = provider.sampleSummaryInto ? provider.sampleSummaryInto(best.x, best.z, best.d, out) : false;
        if (best.truth > maxTruth.h) maxTruth = { h: best.truth, d: best.d };
        rows.push({ d, truth: Math.round(best.truth * 10) / 10, h: Math.round(h * 10) / 10, ok, sh: Math.round(out.height * 10) / 10, mat: out.material, wc: Math.round((out.waterCoverage ?? 0) * 100) / 100 });
      }
      return { pose, maxTruth, rows };
    })()`);
    console.log(JSON.stringify(report, null, 2));
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
