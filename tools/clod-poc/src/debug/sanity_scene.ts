import * as THREE from "three";
import { ACESFilmicToneMapping } from "three";
import { WebGPURenderer } from "three/webgpu";
import { browserGate } from "../core/browser_gate.js";
import { PHASE0 } from "../core/constants.js";
import {
  buildRequiredLimits,
  describeDiagnostics,
  failLoud,
  installGlobalErrorHooks,
  probeWebGPU,
} from "../core/diagnostics.js";
import { EngineStatsTracker } from "../core/engine_stats.js";
import { FlyCamera } from "../core/fly_camera.js";
import { initHooks } from "../core/hooks.js";
import { parseCamString, parseClodParams } from "../core/params.js";
import { WorldSeed } from "../core/seed.js";
import { createPhase0DisplacementMaterial } from "../gpu/phase0_displacement_material.js";
import { createPhase0StorageInstances } from "../gpu/phase0_storage_instancing.js";
import {
  createPhase0StorageTexture,
  createPhase0StorageTexturePanel,
} from "../gpu/phase0_storage_texture.js";
import { Hud } from "../ui/hud.js";
import { PHASE0_LIGHTING } from "./phase0_constants.js";

function hideNormalAppChrome(): void {
  for (const id of ["clod-left-stack", "project-toolbar", "player-mode-bar", "terraform-menu", "build-progress", "crosshair"]) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.setAttribute("hidden", "");
    element.style.display = "none";
  }
}

function updateProgress(progress: number, message: string): void {
  if (!window.__drusnielClod) return;
  window.__drusnielClod.progress = progress;
  window.__drusnielClod.progressMsg = message;
}

function createCpuTerrain(seed: WorldSeed): { mesh: THREE.Mesh; verts: number; tris: number } {
  const segments = PHASE0.cpuTerrainSegments;
  const size = PHASE0.cpuTerrainSize;
  const half = size / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const rng = seed.rng("phase0-cpu-terrain");
  const ridgePhase = rng.range(0, Math.PI * 2);
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      const px = (x / segments) * size - half;
      const pz = (z / segments) * size - half;
      const ridge = Math.sin(px * 0.24 + ridgePhase) * 1.5 + Math.cos(pz * 0.31) * 0.9;
      const column = Math.max(0, 1 - Math.hypot(px + 12, pz - 8) / 9) * 5.0;
      const y = ridge + column - 2.8;
      positions.push(px, y, pz);
    }
  }
  const row = segments + 1;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x5f6b49, roughness: 0.9, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "phase0-cpu-procedural-terrain";
  mesh.receiveShadow = true;
  return { mesh, verts: positions.length / 3, tris: indices.length / 3 };
}

async function buildSanityScene(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  stats: EngineStatsTracker,
  seed: WorldSeed,
): Promise<void> {
  updateProgress(0.2, "phase0: storage texture compute");
  const storageTexture = await createPhase0StorageTexture(renderer, PHASE0.storageTextureSize, seed.sub("storage-texture"));
  scene.add(createPhase0StorageTexturePanel(storageTexture));
  stats.stats.counters["phase0.storageTextureBake"] = 1;

  updateProgress(0.42, "phase0: storage buffer compute");
  const instances = await createPhase0StorageInstances(renderer, PHASE0.storageInstanceCount, seed.sub("storage-instances"));
  scene.add(instances.mesh);
  stats.stats.counters["phase0.storageInstances"] = instances.count;
  stats.stats.counters["phase0.indirectDraws"] = 1;

  updateProgress(0.62, "phase0: cpu procedural geometry");
  const cpuTerrain = createCpuTerrain(seed);
  scene.add(cpuTerrain.mesh);
  stats.stats.counters["phase0.cpuProceduralVerts"] = cpuTerrain.verts;
  stats.stats.counters["phase0.cpuProceduralTris"] = cpuTerrain.tris;

  updateProgress(0.78, "phase0: TSL displacement");
  const displaced = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20, 80, 80).rotateX(-Math.PI / 2),
    createPhase0DisplacementMaterial(storageTexture, seed.sub("displacement")),
  );
  displaced.name = "phase0-tsl-displacement";
  displaced.position.set(18, 1.2, -6);
  displaced.receiveShadow = true;
  scene.add(displaced);
  stats.stats.counters["phase0.tslDisplacement"] = 1;

  const sun = new THREE.DirectionalLight(PHASE0_LIGHTING.sunColor, 3.0);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PHASE0_LIGHTING.hemiSky, PHASE0_LIGHTING.hemiGround, 0.62));
  stats.stats.counters["phase0.seedSignature"] = seed.sub("sanity-signature");
  updateProgress(0.92, "phase0: scene ready");
}

export async function runPhase0SanityScene(): Promise<void> {
  hideNormalAppChrome();
  const hooks = initHooks();
  installGlobalErrorHooks();
  if (!browserGate()) return;

  const params = parseClodParams();
  if (params.renderer !== "webgpu") {
    failLoud("Phase-0 sanity requires WebGPU", ["The sanity scene does not silently fall back to WebGL. Remove ?renderer=webgl."]);
    return;
  }

  updateProgress(0.05, "phase0: probing WebGPU");
  const diagnostics = await probeWebGPU();
  hooks.diag = diagnostics;
  if (!diagnostics.ok) {
    failLoud("WebGPU probe failed", [diagnostics.reason ?? "unknown failure", ...describeDiagnostics(diagnostics)]);
    return;
  }

  updateProgress(0.1, "phase0: creating renderer");
  const renderer = new WebGPURenderer({
    antialias: true,
    trackTimestamp: true,
    requiredLimits: buildRequiredLimits(diagnostics),
  });
  await renderer.init();
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  if (device) {
    let reported = 0;
    device.onuncapturederror = (event: GPUUncapturedErrorEvent) => {
      if (reported++ < 8) console.error("[phase0] WebGPU uncaptured error:", event.error.message);
    };
  }

  const dpr = params.dpr ?? Math.min(window.devicePixelRatio, PHASE0.dprCap);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PHASE0_LIGHTING.background);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.2, 1000);
  const stats = new EngineStatsTracker(renderer, hooks, diagnostics.features.includes("timestamp-query"));
  const seed = new WorldSeed(params.seed);
  await buildSanityScene(renderer, scene, stats, seed);

  const flyCamera = new FlyCamera(camera, renderer.domElement);
  flyCamera.setPose(parseCamString(params.cam ?? PHASE0.initialCam) ?? parseCamString(PHASE0.initialCam)!);
  hooks.setPose = (pose) => flyCamera.setPose(pose);
  hooks.getPose = () => flyCamera.getPose();
  hooks.flyCamEnabled = (on) => {
    flyCamera.enabled = on;
  };

  const hud = new Hud(stats.stats, params, camera);
  const settleWaiters: { frames: number; resolve: () => void }[] = [];
  hooks.settle = (frames = 8) => new Promise((resolve) => settleWaiters.push({ frames, resolve }));

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now();
  renderer.setAnimationLoop((timeMs) => {
    const rawDt = Math.max(0.0001, Math.min((timeMs - last) / 1000, 0.1));
    last = timeMs;
    if (!params.freeze) flyCamera.update(rawDt);
    renderer.render(scene, camera);
    stats.update(rawDt);
    hud.update(rawDt);

    for (const waiter of settleWaiters) waiter.frames -= 1;
    const done = settleWaiters.filter((waiter) => waiter.frames <= 0);
    for (const waiter of done) waiter.resolve();
    for (const waiter of done) settleWaiters.splice(settleWaiters.indexOf(waiter), 1);

    if (!hooks.ready && stats.stats.frame >= PHASE0.settleReadyFrames) {
      hooks.ready = true;
      hooks.progress = 1;
      hooks.progressMsg = "ready";
    }
  });
}
