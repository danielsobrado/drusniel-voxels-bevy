import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clodUrl, launchWebGPU } from "./launch.js";

type ProbeSceneObject = {
  name?: string;
  type?: string;
  isInstancedMesh?: boolean;
  material?: { id: number; name?: string; type?: string } | Array<{ id: number; name?: string; type?: string }>;
  geometry?: { attributes?: Record<string, unknown> };
};

type ProbeSceneWindow = Window & {
  __drusnielScene?: { traverse: (visit: (object: ProbeSceneObject) => void) => void };
};

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const { browser } = await launchWebGPU();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const url = clodUrl({
    scene: "continent", seed: 19, freeze: true,
    extra: {
      world: "8", startupWorld: "2", continentHydrology: "1", gpuTileMesh: "1",
      treeGpu: "0", stoneGpu: "0", understoryGpu: "0", grassGpu: "0", canopy: "0",
    },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  let timedOut = false;
  await page.waitForFunction(() => {
    const counters = window.__drusnielClod?.stats?.counters;
    return window.__drusnielClod?.ready === true
      && (counters?.heightfield_tiles_resident ?? 0) > 0
      && (counters?.heightfield_tile_gpu_atlas_resident ?? 0) > 0
      && (counters?.live_clod_stream_gpu_pages_dispatched ?? 0) > 0
      || window.__drusnielClod?.error != null
      || (counters?.live_clod_stream_gpu_failed_batches ?? 0) > 0
      || (counters?.live_clod_stream_worker_fallback_pages ?? 0) > 0
      || (counters?.heightfield_tiles_failures_total ?? 0) > 0;
  }, undefined, { timeout: 120_000, polling: 250 }).catch(() => { timedOut = true; });
  const result = await page.evaluate(() => {
    const materials: Array<Record<string, unknown>> = [];
    const scene = (window as unknown as ProbeSceneWindow).__drusnielScene;
    scene?.traverse((object) => {
      const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of objectMaterials) {
        materials.push({
          materialId: material.id,
          materialName: material.name ?? "",
          materialType: material.type ?? "",
          objectName: object.name ?? "",
          objectType: object.type ?? "",
          instanced: object.isInstancedMesh === true,
          attributes: Object.keys(object.geometry?.attributes ?? {}),
        });
      }
    });
    return {
      error: window.__drusnielClod?.error ?? null,
      manifest: window.__drusnielClod?.diag?.worldManifest ?? null,
      startup: window.__drusnielStartupTimings ?? null,
      counters: window.__drusnielClod?.stats?.counters ?? null,
      materials,
    };
  });
  const report = { url, timedOut, errors, result };
  console.log(JSON.stringify(report, null, 2));
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
  if (timedOut || result.error || errors.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
