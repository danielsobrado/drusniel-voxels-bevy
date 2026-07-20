// Temporary diagnostic: identify which mesh/material renders the mid-distance land.
import { settleFrames, withWaterHarness } from "./water-harness.js";

async function main(): Promise<void> {
  const url = "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&world=8&quality=ultra&renderPreset=ultra&materialTiers=1&toneMap=agx";
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
    await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(120) : true");
    await settleFrames(page, 120);
    const report = await page.evaluate(`(() => {
      let root = window.__drusnielClod?.scene ?? window.__drusnielScene ?? null;
      if (!root) {
        let walk = window.__drusnielInfiniteFarShell?.mesh ?? null;
        while (walk && walk.parent) walk = walk.parent;
        if (walk && walk.isScene) root = walk;
      }
      if (!root || !root.isScene) return { error: "no scene", shell: Boolean(window.__drusnielInfiniteFarShell) };
      const pose = window.__drusnielClod.getPose();
      const probe = window.waterProbe;
      // A point ~600 m from camera on land above water.
      let target = null;
      for (let d = 400; d <= 2500 && !target; d += 100) {
        for (let a = 0; a < 6.28; a += 0.5) {
          const x = pose.p[0] + Math.cos(a) * d, z = pose.p[2] + Math.sin(a) * d;
          const y = probe(x, z).terrain;
          if (y > 20 && y < 40) { target = { x, y, z, d }; break; }
        }
      }
      if (!target) return { error: "no land point found" };
      const hits = [];
      root.updateMatrixWorld(true);
      root.traverse((node) => {
        if (!node.isMesh || !node.visible || !node.geometry) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox?.();
        const box = node.geometry.boundingBox;
        if (!box) return;
        const e = node.matrixWorld.elements;
        // Local-space target assuming translation-only world matrices.
        const lx = target.x - e[12];
        const ly = target.y - e[13];
        const lz = target.z - e[14];
        if (lx >= box.min.x && lx <= box.max.x
          && lz >= box.min.z && lz <= box.max.z
          && ly >= box.min.y - 8 && ly <= box.max.y + 8) {
          const material = Array.isArray(node.material) ? node.material[0] : node.material;
          const span = Math.round(box.max.x - box.min.x);
          hits.push({
            mesh: node.name || "(anon)",
            parent: node.parent?.name || "(anon)",
            mat: material?.name || material?.type,
            verts: node.geometry.attributes?.position?.count ?? 0,
            vc: Boolean(node.geometry.attributes?.color),
            span,
            pos: [Math.round(e[12]), Math.round(e[13]), Math.round(e[14])],
          });
        }
      });
      hits.sort((a, b) => a.span - b.span);
      return { target, hits: hits.slice(0, 12) };
    })()`);
    console.log(JSON.stringify(report, null, 2));
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
