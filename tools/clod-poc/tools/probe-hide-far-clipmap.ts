// Temporary diagnostic: capture the ridge pose with and without the far-clipmap
// meshes to attribute which renderer draws the mid-distance land.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { settleFrames, withWaterHarness } from "./water-harness.js";

async function main(): Promise<void> {
  const url = "http://127.0.0.1:5180/?scene=infinite-islands&seed=1&world=8&quality=ultra&renderPreset=ultra&materialTiers=1&toneMap=agx";
  const out = "qa-runs/probe-hide-far-clipmap";
  mkdirSync(out, { recursive: true });
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
    await page.evaluate(`(() => {
      const probe = window.waterProbe;
      let ridge = { x: 1024, z: 1024, y: -Infinity };
      for (let z = 256; z < 4096; z += 48) {
        for (let x = 256; x < 4096; x += 48) {
          const y = probe(x, z).terrain;
          if (y > ridge.y) ridge = { x, z, y };
        }
      }
      window.__drusnielClod.setPose({ p: [ridge.x, ridge.y + 26, ridge.z], yaw: Math.PI * 0.75, pitch: -0.12 });
    })()`);
    await page.evaluate("window.__drusnielClod?.settle ? window.__drusnielClod.settle(300) : true");
    await settleFrames(page, 90);
    await page.evaluate(`[...document.body.children].forEach((el) => { if (el.tagName !== "CANVAS") el.style.visibility = "hidden"; })`);
    await page.screenshot(join(out, "with-clipmap.png"));
    const hidden = await page.evaluate(`(() => {
      const keys = Object.keys(window).filter((k) => k.startsWith("__drusniel"));
      const clodKeys = window.__drusnielClod ? Object.keys(window.__drusnielClod) : [];
      let scene = window.__drusnielClod?.scene ?? window.__drusnielScene;
      if (!scene && window.__drusnielInfiniteFarShell?.mesh) {
        let root = window.__drusnielInfiniteFarShell.mesh;
        while (root.parent) root = root.parent;
        if (root.isScene) scene = root;
      }
      if (!scene) return { keys, clodKeys, error: "no scene handle" };
      const census = new Map();
      scene.traverse((node) => {
        if (!node.isMesh || !node.visible) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const key = material?.name || material?.type || "(none)";
        const entry = census.get(key) ?? { count: 0, colorWrite: material?.colorWrite !== false, verts: 0 };
        entry.count++;
        entry.verts += node.geometry?.attributes?.position?.count ?? 0;
        census.set(key, entry);
      });
      window.__probeHide = (prefix) => {
        let n = 0;
        scene.traverse((node) => {
          if (!node.isMesh) return;
          const material = Array.isArray(node.material) ? node.material[0] : node.material;
          const key = material?.name || material?.type || "(none)";
          if (key.startsWith(prefix)) { node.visible = false; n++; }
        });
        return n;
      };
      return Object.fromEntries([...census.entries()].map(([k, v]) => [k, v.count + " meshes, " + v.verts + " verts, colorWrite=" + v.colorWrite]));
    })()`);
    console.log("census:", JSON.stringify(hidden, null, 2));
    await settleFrames(page, 30);
    await page.screenshot(join(out, "without-clipmap.png"));
    for (const prefix of ["clod-page", "terrain", "far", "Far", "Drusniel"]) {
      const n = await page.evaluate(`window.__probeHide(${JSON.stringify(prefix)})`);
      console.log("hid prefix", prefix, ":", n);
      await settleFrames(page, 20);
      await page.screenshot(join(out, `hide-${prefix.toLowerCase()}.png`));
    }
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
