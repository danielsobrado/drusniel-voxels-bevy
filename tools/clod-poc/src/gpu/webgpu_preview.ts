// Phase 2c WebGPU app path (docs/webgpu-migration.md). Reached via `?webgpu=1`.
//
// Parallel-path migration strategy: this grows the isolated WebGPU viewer toward the real
// app, reusing the pure logic (buildWorld + selectCut) but with its own slim render path, so
// the WebGL app stays untouched. It now does real camera-driven CLOD selection: as the
// camera moves, selectCut chooses the adaptive cut each frame and the matching terrain
// meshes are shown, rendered through WebGPURenderer with the ported terrain NodeMaterial.
//
// Not yet here (later 2c steps / Phase 3+): dig editing, grass/stones/sky/post, the full GUI,
// and the deferred terrain features (normal-map, paint blend, LOD cross-fade dither).
// Dynamically imported (see main.ts) so `three/webgpu` stays out of the normal bundle.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WebGPURenderer } from "three/webgpu";
import { parseConfig } from "../config.js";
import { buildWorld } from "../quadtree.js";
import { initSimplifier } from "../simplify.js";
import { selectCut, type SelectionParams, type SelectionState } from "../selection.js";
import { DEFAULT_GRASS_SETTINGS, generateGrassInstances } from "../grass.js";
import type { ClodPageNode } from "../types.js";
import configText from "../../config/clod_pages.yaml?raw";
import { buildGrassInstancedGeometry, createGrassNodeMaterial } from "./grass_node_material.js";
import {
  createTerrainNodeMaterial,
  type TerrainNodeTextureSlot,
} from "./terrain_node_material.js";
import { createSkyNodeMaterial } from "./sky_node_material.js";

// A few distinctly-coloured noisy layers, so triplanar texture-array sampling is visibly
// exercised (NOT the app's real textures — this only proves the TSL array path renders).
function proceduralAlbedoArray(): THREE.DataArrayTexture {
  const size = 64;
  const tints: Array<[number, number, number]> = [
    [70, 110, 55], // low: grass-green
    [120, 115, 105], // mid: rock-grey
    [235, 238, 245], // high: snow-white
  ];
  const stride = size * size * 4;
  const data = new Uint8Array(stride * tints.length);
  for (let layer = 0; layer < tints.length; layer++) {
    const [r, g, b] = tints[layer];
    for (let p = 0; p < size * size; p++) {
      const noise = (Math.sin(p * 12.9898 + layer * 78.233) * 43758.5453) % 1;
      const j = (Math.abs(noise) - 0.5) * 36;
      const o = layer * stride + p * 4;
      data[o] = Math.max(0, Math.min(255, r + j));
      data[o + 1] = Math.max(0, Math.min(255, g + j));
      data[o + 2] = Math.max(0, Math.min(255, b + j));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataArrayTexture(data, size, size, tints.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function terrainGeometry(node: ClodPageNode): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(node.mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(node.mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(node.mesh.indices, 1));
  return g;
}

// The preview short-circuits main(), so the app's UI shell never initializes and would sit
// frozen at "building…"/"preparing". Hide the chrome; only the canvas + preview overlay show.
function hideAppChrome(): void {
  for (const id of [
    "clod-left-stack",
    "project-toolbar",
    "player-mode-bar",
    "crosshair",
    "terraform-menu",
    "build-progress",
  ]) {
    document.getElementById(id)?.style.setProperty("display", "none");
  }
}

function makeOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:10;font:12px/1.4 monospace;" +
    "color:#cde;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;white-space:pre";
  document.body.appendChild(el);
  return el;
}

export async function runWebGpuPreview(searchParams: URLSearchParams): Promise<void> {
  hideAppChrome();
  const overlay = makeOverlay();
  overlay.textContent = "WebGPU CLOD preview: building world…";

  // Synchronous main-thread build, so keep the world small. buildWorld -> simplifyPage
  // needs the meshoptimizer WASM ready (the worker path does this before building).
  await initSimplifier();
  const cfg = parseConfig(configText);
  const requested = Number(searchParams.get("world"));
  const world = Number.isFinite(requested) ? Math.min(Math.max(requested, 2), 8) : 4;
  const result = buildWorld(world, world, cfg);
  const allNodes: ClodPageNode[] = [...result.nodesByLevel.values()].flat();

  const renderer = new WebGPURenderer({ antialias: true });
  try {
    await renderer.init();
  } catch (error) {
    overlay.textContent = `WebGPU preview FAILED to init:\n${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  const backendName = device ? "WebGPU" : "WebGL fallback";
  if (device) {
    let reported = 0;
    device.onuncapturederror = (e: GPUUncapturedErrorEvent): void => {
      if (reported++ < 8) console.error("[webgpu-preview] uncaptured error:", e.error.message);
    };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Sky dome (Phase 3): follows the camera, drawn first; also yields the sun/sky/ground
  // lighting used to light the terrain so both agree.
  const sky = createSkyNodeMaterial();
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), sky.material);
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  // Optional texture-array path (?tex=1): split the terrain's vertical extent into 3 bands.
  const useTextures = searchParams.get("tex") === "1";
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of allNodes) {
    const pos = node.mesh.positions;
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < minY) minY = pos[i];
      if (pos[i] > maxY) maxY = pos[i];
    }
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 1;
  }
  const band = (maxY - minY) / 3;
  const slots: TerrainNodeTextureSlot[] = [0, 1, 2].map((i) => ({
    scale: 1 / 8,
    heightMin: minY + band * i,
    heightMax: minY + band * (i + 1),
  }));
  const { material } = createTerrainNodeMaterial({
    // Light the terrain with the sky's sun/sky/ground so the two agree.
    lighting: {
      lightDir: sky.lighting.sunDirection,
      sunColor: sky.lighting.sunColor,
      skyLight: sky.lighting.skyLight,
      groundLight: sky.lighting.groundLight,
      baseColor: new THREE.Color(0xb9c0c8),
      roughness: 0.9,
    },
    textures: useTextures
      ? {
          albedoArray: proceduralAlbedoArray(),
          slots,
          blendBands: true,
          blendWidth: Math.max(band * 0.25, 1),
        }
      : null,
  });

  // Lazily realise one mesh per node; shared material. Visibility is driven by the cut.
  const views = new Map<string, THREE.Mesh>();
  const meshFor = (node: ClodPageNode): THREE.Mesh => {
    let mesh = views.get(node.id);
    if (!mesh) {
      mesh = new THREE.Mesh(terrainGeometry(node), material);
      mesh.visible = false;
      scene.add(mesh);
      views.set(node.id, mesh);
    }
    return mesh;
  };

  // Optional grass (?grass=1): classic-mode blades placed on LOD0 footprints (reusing the
  // app's generateGrassInstances), rendered with the ported instanced grass NodeMaterial.
  const useGrass = searchParams.get("grass") === "1";
  let grass: ReturnType<typeof createGrassNodeMaterial> | null = null;
  let grassBlades = 0;
  if (useGrass) {
    const grassSettings = { ...DEFAULT_GRASS_SETTINGS, shaderMode: "classic" as const };
    grass = createGrassNodeMaterial({
      lighting: sky.lighting,
      bladeWidth: grassSettings.bladeWidth,
      windStrength: grassSettings.windStrength,
      windSpeed: grassSettings.windSpeed,
    });
    const lod0 = result.nodesByLevel.get(0) ?? [];
    for (const node of lod0) {
      const instances = generateGrassInstances(node.footprint, grassSettings);
      if (instances.length === 0) continue;
      const mesh = new THREE.Mesh(buildGrassInstancedGeometry(instances), grass.material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      grassBlades += instances.length;
    }
  }

  const worldCells = world * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);
  controls.update();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let selState: SelectionState = { split: new Set() };
  let visibleIds = new Set<string>();
  let renderedCount = 0;
  let triangles = 0;
  let levelSummary = "";

  const updateSelection = (): void => {
    const params: SelectionParams = {
      thresholdPx: cfg.selection.error_threshold_px,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      enforce21: true,
      viewportH: renderer.domElement.height,
      fovY: (camera.fov * Math.PI) / 180,
      camPos: [camera.position.x, camera.position.y, camera.position.z],
      forcedMaxLevel: null,
    };
    const { rendered, state } = selectCut(result.roots, params, selState);
    selState = state;

    const nextVisible = new Set<string>();
    triangles = 0;
    const perLevel = new Map<number, number>();
    for (const node of rendered) {
      meshFor(node).visible = true;
      nextVisible.add(node.id);
      triangles += node.mesh.indices.length / 3;
      perLevel.set(node.level, (perLevel.get(node.level) ?? 0) + 1);
    }
    for (const id of visibleIds) {
      if (!nextVisible.has(id)) {
        const mesh = views.get(id);
        if (mesh) mesh.visible = false;
      }
    }
    visibleIds = nextVisible;
    renderedCount = rendered.length;
    levelSummary = [...perLevel.keys()].sort((a, b) => a - b).map((l) => `L${l}:${perLevel.get(l)}`).join(" ");
  };

  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let elapsed = 0;
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;
    grass?.setTime(elapsed);
    frames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fps = frames / fpsAccum;
      frames = 0;
      fpsAccum = 0;
    }
    controls.update();
    skyDome.position.copy(camera.position);
    updateSelection();
    renderer.render(scene, camera);
    overlay.textContent =
      `WebGPU CLOD preview — backend: ${backendName}\n` +
      `world: ${world}x${world}   textures: ${useTextures ? "on (procedural)" : "off"}\n` +
      `cut: ${renderedCount} nodes   ${levelSummary}\n` +
      `fps: ${fps.toFixed(0)}   triangles: ${triangles.toLocaleString()}` +
      (useGrass ? `   grass blades: ${grassBlades.toLocaleString()}` : "");
  });
}
