// Temporary diagnostic: identify which system draws the dark shapes in the
// tree impostor visual-gate scene by inventorying and bisecting the scene graph.
import { clodUrl, launchWebGPU } from "./launch.js";

const CLOSE_POSE = {
  p: [512, 116, 732] as [number, number, number],
  yaw: 0,
  pitch: -0.365,
  fov: 55,
};

type SceneWindow = Window & {
  __drusnielScene?: {
    children: { name: string; visible: boolean }[];
    getObjectByName(name: string): { visible: boolean } | undefined;
    traverse(cb: (object: unknown) => void): void;
  };
};

async function main(): Promise<void> {
  const url = clodUrl({ scene: "infinite-islands", freeze: true, extra: { freeze: "1" } });
  const { browser } = await launchWebGPU();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__drusnielClod && (window.__drusnielClod.ready || window.__drusnielClod.error !== null),
      undefined,
      { timeout: 180_000, polling: 250 },
    );
    await page.evaluate(async (pose) => {
      window.__drusnielClod?.flyCamEnabled?.(false);
      window.__drusnielClod?.setPose?.(pose);
      await window.__drusnielClod?.settle?.(600);
    }, CLOSE_POSE);

    const inventory = await page.evaluate(() => {
      const scene = (window as unknown as SceneWindow).__drusnielScene;
      if (!scene) return { error: "no scene handle" };
      const rows: Record<string, { meshes: number; instances: number; visible: number }> = {};
      const topGroups = scene.children.map((child) => `${child.name || "(unnamed)"}:${child.visible ? "on" : "off"}`);
      scene.traverse((object) => {
        const mesh = object as { isMesh?: boolean; name?: string; visible?: boolean; count?: number };
        if (!mesh.isMesh) return;
        const key = (mesh.name || "(unnamed mesh)").replace(/-?\d+([.,:]-?\d+)*/g, "#");
        rows[key] ??= { meshes: 0, instances: 0, visible: 0 };
        rows[key].meshes++;
        rows[key].instances += mesh.count ?? 1;
        if (mesh.visible) rows[key].visible++;
      });
      return { topGroups, rows };
    });
    console.log(JSON.stringify(inventory, null, 2));

    await page.screenshot({ path: "shots/trees/impostor-probe-base.png" });

    const atlasShown = await page.evaluate(async () => {
      const modulePath: string = "/@id/three";
      const three = await import(/* @vite-ignore */ modulePath) as typeof import("three");
      const scene = (window as unknown as SceneWindow).__drusnielScene as unknown as import("three").Scene;
      const atlases = (window as unknown as { __drusnielTreeImpostorAtlasRefs?: Record<string, { albedo?: import("three").Texture }> }).__drusnielTreeImpostorAtlasRefs;
      const atlas = atlases?.oak;
      if (!scene || !atlas?.albedo) return false;
      const plane = new three.Mesh(
        new three.PlaneGeometry(45, 90),
        new three.MeshBasicMaterial({ map: atlas.albedo, transparent: true, side: three.DoubleSide }),
      );
      plane.name = "impostor-atlas-debug-quad";
      // In front of CLOSE_POSE camera at [434, 80, 590] looking toward [512, ~, 512].
      plane.position.set(462, 70, 562);
      plane.lookAt(434, 80, 590);
      scene.add(plane);
      await window.__drusnielClod?.settle?.(8);
      return true;
    });
    if (atlasShown) {
      await page.screenshot({ path: "shots/trees/impostor-probe-atlas.png" });
      console.log("[probe] wrote shots/trees/impostor-probe-atlas.png");
      await page.evaluate(async () => {
        const scene = (window as unknown as SceneWindow).__drusnielScene as unknown as import("three").Scene;
        const quad = scene?.getObjectByName("impostor-atlas-debug-quad");
        if (quad) quad.removeFromParent();
        await window.__drusnielClod?.settle?.(2);
      });
    } else {
      console.log("[probe] atlas quad not shown (no scene or atlas ref)");
    }

    for (const tier of ["impostor", "far", "mid", "near"]) {
      // The ring updater re-sets mesh.visible every dispatch, so park the tier
      // on an unused layer instead. Shadow meshes live on layers 2+; skip them.
      await page.evaluate(async (name) => {
        const scene = (window as unknown as SceneWindow).__drusnielScene;
        scene?.traverse((object) => {
          const mesh = object as { isMesh?: boolean; name?: string; layers?: { set(layer: number): void } };
          if (mesh.isMesh && mesh.name?.startsWith("trees-ring-gpu-") && !mesh.name.includes("-shadow-")
            && !mesh.name.includes("prepass") && mesh.name.endsWith(`-${name}`)) {
            mesh.layers?.set(31);
          }
        });
        await window.__drusnielClod?.settle?.(8);
      }, tier);
      await page.screenshot({ path: `shots/trees/impostor-probe-hide-tier-${tier}.png` });
      console.log(`[probe] wrote shots/trees/impostor-probe-hide-tier-${tier}.png`);
      await page.evaluate(async (name) => {
        const scene = (window as unknown as SceneWindow).__drusnielScene;
        scene?.traverse((object) => {
          const mesh = object as { isMesh?: boolean; name?: string; layers?: { set(layer: number): void } };
          if (mesh.isMesh && mesh.name?.startsWith("trees-ring-gpu-") && !mesh.name.includes("-shadow-")
            && !mesh.name.includes("prepass") && mesh.name.endsWith(`-${name}`)) {
            mesh.layers?.set(0);
          }
        });
        await window.__drusnielClod?.settle?.(2);
      }, tier);
    }

    for (const hide of ["CanopyTileBounds", "CanopyFadeZone", "CanopyGpuImpostors", "trees"]) {
      const hidden = await page.evaluate(async (name) => {
        const scene = (window as unknown as SceneWindow).__drusnielScene;
        const group = scene?.getObjectByName(name);
        if (!group) return false;
        group.visible = false;
        await window.__drusnielClod?.settle?.(8);
        return true;
      }, hide);
      if (!hidden) {
        console.log(`[probe] group not found: ${hide}`);
        continue;
      }
      await page.screenshot({ path: `shots/trees/impostor-probe-hide-${hide}.png` });
      console.log(`[probe] wrote shots/trees/impostor-probe-hide-${hide}.png`);
      await page.evaluate(async (name) => {
        const scene = (window as unknown as SceneWindow).__drusnielScene;
        const group = scene?.getObjectByName(name);
        if (group) group.visible = true;
        await window.__drusnielClod?.settle?.(2);
      }, hide);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error("[probe-tree-impostors] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
