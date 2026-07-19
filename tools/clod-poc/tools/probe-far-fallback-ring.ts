// Temporary diagnostic: compare far-summary provider heights vs near-field truth
// in the CLOD fallback ring (inside the far-clipmap inner radius).
import { withWaterHarness } from "./water-harness.js";

async function main(): Promise<void> {
  const url = "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&world=8&quality=low";
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
      for (const d of [200, 350, 500, 650, 800, 1000, 1500, 2500]) {
        for (const ang of [0, 2.1, 4.2]) {
          const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
          const h = provider.sampleHeight(x, z);
          const out = { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0, waterCoverage: 0, waterLevel: 0, bodyKind: 0, shoreDistance: 0, unifiedChannels: false };
          const ok = provider.sampleSummaryInto ? provider.sampleSummaryInto(x, z, d, out) : false;
          const truth = window.waterProbe ? window.waterProbe(x, z).terrain : null;
          rows.push({ d, ang, h: Math.round(h * 10) / 10, ok, sh: Math.round(out.height * 10) / 10, mat: out.material, wc: out.waterCoverage, truth: truth === null ? null : Math.round(truth * 10) / 10 });
        }
      }
      return { pose, rows };
    })()`);
    console.log(JSON.stringify(report, null, 2));
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
