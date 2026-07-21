// Sample the tree GPU-ring LOD counts over N frames with a frozen camera.
// If near/mid/far/impostor counts jitter frame to frame, trees are being appended/dropped
// nondeterministically each dispatch (atomicAdd slot races / per-group overflow), which
// is the mechanism behind per-frame tree blinking.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const query = process.argv[2]
  ?? "?oceanRim=0&webgpuSelection=1&materialTiers=1&customProps=1&treeCounts=1";
const FRAMES = Number(process.argv[3] ?? 40);

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
    page.on("pageerror", (e) => console.error("[lod] pageerror:", e.message));
    await page.goto(new URL(query, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      `(function(){ var s=window.__drusnielScene; if(!s) return false; var n=0; s.traverse(function(o){ if(o.isMesh&&o.visible&&(o.name||'').indexOf('tree')>=0) n++; }); return n>0; })()`,
      undefined, { timeout: 300000, polling: 1000 },
    );
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 25000));

    // Park the camera among trees if the pose hook is available.
    await page.evaluate(`(function(){
      var h = window.__drusnielClod;
      if (h && typeof h.setPose === 'function') {
        h.setPose({ p: [${process.env.CAMX ?? 256}, ${process.env.CAMY ?? 42}, ${process.env.CAMZ ?? 282}], yaw: 0.6, pitch: -0.12, fov: 55 });
        return 'posed';
      }
      return 'no setPose';
    })()`).then((r) => console.log(`[lod] ${r}`));
    await page.waitForTimeout(2500);

    const samples: string[] = [];
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const line = await page.evaluate(`(function(){
        var t = document.body.innerText || "";
        var m = t.match(/near\\/mid\\/far\\/impostor\\s*([0-9]+\\/[0-9]+\\/[0-9]+\\/[0-9]+)/i);
        if (m) return m[1];
        var g = t.match(/gpu-ring[^\\n]*/i);
        return g ? g[0].slice(0, 120) : "(no counts line)";
      })()`);
      samples.push(String(line));
    }

    const uniq = new Map<string, number>();
    for (const s of samples) uniq.set(s, (uniq.get(s) ?? 0) + 1);
    console.log(`\n[lod] sampled ${samples.length} frames, ${uniq.size} distinct count-states`);
    for (const [value, n] of [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${String(n).padStart(3)}x  ${value}`);
    }
    const nums = samples.map((s) => s.split("/").map(Number)).filter((a) => a.length === 4 && a.every(Number.isFinite));
    if (nums.length > 1) {
      const labels = ["near", "mid", "far", "impostor"];
      for (let k = 0; k < 4; k++) {
        const col = nums.map((a) => a[k]);
        const lo = Math.min(...col), hi = Math.max(...col);
        console.log(`  ${labels[k].padEnd(9)} min=${lo} max=${hi} jitter=${hi - lo}`);
      }
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error("[lod] failed:", e); process.exitCode = 1; });
