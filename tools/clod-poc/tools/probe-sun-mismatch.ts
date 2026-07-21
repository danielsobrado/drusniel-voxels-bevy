// Temporary probe: compares the direction the shadow-casting sun actually uses
// against the direction every shading path uses. Delete after the session.
import { launchWebGPU, clodBaseUrl } from "./launch.js";

const BASE = process.env.CLOD_POC_BASE_URL ?? clodBaseUrl();
const QUERIES = process.argv.slice(2);
const CASES = QUERIES.length
  ? QUERIES
  : [
      "?world=8&scene=trees-perf&hud=0",
      "?world=8&scene=trees-perf&hud=0&sunAzimuthDeg=300&sunElevationDeg=20",
    ];

async function main(): Promise<void> {
  const { browser } = await launchWebGPU();
  try {
    for (const q of CASES) {
      const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
      await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });
      page.on("pageerror", (err) => console.error("[sun] pageerror:", err.message));
      await page.goto(new URL(q, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(
        "!!(window.__drusnielClod && (window.__drusnielClod.ready === true || window.__drusnielClod.error))",
        undefined,
        { timeout: 300000, polling: 500 },
      );
      await page.waitForTimeout(4000);

      const out = await page.evaluate(`(function(){
        function deg(v){ return Math.round(v * 180 / Math.PI); }
        function angles(x, y, z){
          var len = Math.sqrt(x*x + y*y + z*z) || 1;
          x/=len; y/=len; z/=len;
          return { elevationDeg: deg(Math.asin(y)), azimuthDeg: (deg(Math.atan2(x, z)) + 360) % 360,
                   dir: [ +x.toFixed(4), +y.toFixed(4), +z.toFixed(4) ] };
        }
        var res = {};
        // Direction the shadow-casting light actually points from.
        var h = window.__drusnielRealtimeSunShadows;
        if (h && h.sun) {
          var d = h.sun.position.clone().sub(h.sun.target.position);
          res.shadowLight = angles(d.x, d.y, d.z);
        }
        // Direction every shading path uses (tree/impostor live lighting uniform).
        var scene = window.__drusnielScene;
        var seen = {};
        scene && scene.traverse(function(o){
          var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (var i=0;i<mats.length;i++){
            var m = mats[i]; if(!m) continue;
            var u = (m.uniforms && m.uniforms.uTreeImpostorSunDirection && m.uniforms.uTreeImpostorSunDirection.value)
                 || (m.userData && m.userData.treeImpostorLiveLighting && m.userData.treeImpostorLiveLighting.light && m.userData.treeImpostorLiveLighting.light.value);
            if (u && !seen[m.uuid]) { seen[m.uuid] = 1; res.treeShading = res.treeShading || angles(u.x, u.y, u.z); }
          }
        });
        // Sky/postfx sun direction hook, if present.
        var pf = window.__drusnielSunLightSunDirection;
        if (pf) { var v = (typeof pf === 'function') ? pf() : pf; if (v) res.sunLightHook = angles(v.x, v.y, v.z); }
        return res;
      })()`);
      console.log(`\n[sun] ${q}`);
      console.log(JSON.stringify(out, null, 2));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[sun] failed:", error);
  process.exitCode = 1;
});
