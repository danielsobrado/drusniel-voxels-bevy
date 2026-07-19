// Temporary diagnostic: sample the far-summary height provider over open ocean.
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
    const shellReport = await page.evaluate(`(() => {
      const shell = window.__drusnielInfiniteFarShell;
      if (!shell) return { error: "no shell global" };
      const opts = shell.options ?? {};
      const mask = shell.oceanMask;
      let maskOn = 0;
      if (mask) for (let i = 0; i < mask.length; i++) maskOn += mask[i];
      const pos = shell.mesh.geometry.getAttribute("position");
      const col = shell.mesh.geometry.getAttribute("color");
      let nearSea = 0, oceanColored = 0, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        if (y > 16 && y < 18) nearSea++;
        if (col && Math.abs(col.getX(i) - 0.10) < 0.02 && Math.abs(col.getZ(i) - 0.30) < 0.02) oceanColored++;
      }
      return {
        seaLevelMeters: opts.seaLevelMeters,
        inner: opts.innerMeters, outer: opts.outerMeters,
        mode: shell.heightSamplingMode,
        maskLen: mask ? mask.length : null, maskOn,
        vertexCount: pos.count, nearSea, oceanColored, minY, maxY,
        useParity: shell.useParityMaterial,
        rebuilds: shell.rebuildCount, pending: !!shell.pendingHeightRebuild,
        hasProvider: !!shell.heightProvider,
      };
    })()`);
    console.log("shell:", JSON.stringify(shellReport, null, 2));
    const bootReport = await page.evaluate(`(() => ({
      search: location.search,
      farShellCpuHeights: new URLSearchParams(location.search).get("farShellCpuHeights"),
      ownership: window.__drusnielFarOwnership ?? null,
      worldMode: window.__drusnielWorldMode ?? null,
    }))()`);
    console.log("boot:", JSON.stringify(bootReport, null, 2));
    const manualReport = await page.evaluate(`(async () => {
      const shell = window.__drusnielInfiniteFarShell;
      const integ = window.__drusnielFarSummary;
      if (!shell || !integ) return { error: "missing globals" };
      shell.setHeightProvider(integ.getHeightProvider());
      const t0 = Date.now();
      while (shell.pendingHeightRebuild && Date.now() - t0 < 30000) {
        shell.stepPendingHeightRebuild();
        await new Promise((r) => setTimeout(r, 0));
      }
      const pos = shell.mesh.geometry.getAttribute("position");
      const col = shell.mesh.geometry.getAttribute("color");
      let minY = Infinity, maxY = -Infinity, oceanColored = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (col && Math.abs(col.getX(i) - 0.10) < 0.02 && Math.abs(col.getZ(i) - 0.30) < 0.02) oceanColored++;
      }
      let maskOn = 0;
      const mask = shell.oceanMask;
      if (mask) for (let i = 0; i < mask.length; i++) maskOn += mask[i];
      return { rebuilds: shell.rebuildCount, pending: !!shell.pendingHeightRebuild,
        minY, maxY, oceanColored, maskLen: mask ? mask.length : null, maskOn, total: pos.count };
    })()`);
    console.log("manual:", JSON.stringify(manualReport, null, 2));
    const report = await page.evaluate(`(() => {
      const integ = window.__drusnielFarSummary;
      if (!integ) return { error: "no __drusnielFarSummary" };
      const provider = integ.getHeightProvider();
      const pose = window.__drusnielClod.getPose ? window.__drusnielClod.getPose() : null;
      const rows = [];
      let minH = Infinity, maxH = -Infinity, waterCells = 0, total = 0;
      for (let x = 0; x <= 12000; x += 1500) {
        for (let z = 0; z <= 12000; z += 1500) {
          const d = Math.hypot(x - 4096, z - 4096);
          const h = provider.sampleHeight(x, z);
          const out = { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0 };
          const ok = provider.sampleSummaryInto ? provider.sampleSummaryInto(x, z, d, out) : false;
          if (Number.isFinite(h)) { minH = Math.min(minH, h); maxH = Math.max(maxH, h); }
          total++;
          if ((out.waterCoverage ?? 0) > 0.5) waterCells++;
          if (rows.length < 12) rows.push({ x, z, h, ok, sh: out.height, mat: out.material,
            wc: out.waterCoverage, wl: out.waterLevel, bk: out.bodyKind });
        }
      }
      return { pose, minH, maxH, waterCells, total, rows };
    })()`);
    console.log(JSON.stringify(report, null, 2));
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
