// Phase 1 de-risk spike for the WebGPURenderer migration (docs/webgpu-migration.md).
// Standalone bring-up reached via `?webgpuSpike=1`: it does NOT touch the real app path.
// It answers one question — does the three r0.184 WebGPURenderer + TSL toolchain run in
// our exact Vite setup, render a NodeMaterial, and hold a sane frame rate?
//
// Dynamically imported (see main.ts) so `three/webgpu` stays out of the normal bundle.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { normalWorld, positionWorld } from "three/tsl";

function makeOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:10;font:12px/1.4 monospace;" +
    "color:#cde;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;white-space:pre";
  document.body.appendChild(el);
  return el;
}

export async function runWebGpuSpike(): Promise<void> {
  // Hide the world-build overlay; the spike never runs the normal build path.
  document.getElementById("build-progress")?.setAttribute("hidden", "");

  const overlay = makeOverlay();
  overlay.textContent = "WebGPU spike: initializing…";

  const renderer = new WebGPURenderer({ antialias: true });
  // fail-loud: surface WebGPU validation errors, otherwise they show as silent black
  // frames (per the fable5 Engine bring-up).
  try {
    await renderer.init();
  } catch (error) {
    overlay.textContent = `WebGPU spike FAILED to init:\n${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  const backendName = device ? "WebGPU" : "WebGL fallback";
  if (device) {
    let reported = 0;
    device.onuncapturederror = (e: GPUUncapturedErrorEvent): void => {
      if (reported++ < 8) console.error("[webgpu-spike] uncaptured error:", e.error.message);
    };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10141c);
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(6, 5, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x404858, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(5, 8, 4);
  scene.add(sun);

  // TSL NodeMaterial: world-normal visualisation tinted by world height. Proves the TSL
  // graph (normalWorld / positionWorld / vec3 ops) compiles and runs on the device.
  const material = new MeshStandardNodeMaterial();
  material.colorNode = normalWorld
    .mul(0.5)
    .add(0.5)
    .mul(positionWorld.y.mul(0.12).add(0.7).clamp(0.3, 1.0));
  material.roughness = 0.6;

  // A grid of instanced-ish meshes to put real draw/triangle load on the renderer.
  const geometry = new THREE.TorusKnotGeometry(0.5, 0.18, 96, 16);
  const group = new THREE.Group();
  const span = 4;
  for (let x = -span; x <= span; x++) {
    for (let z = -span; z <= span; z++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x * 1.6, Math.sin(x * 0.7 + z * 0.5) * 0.6, z * 1.6);
      group.add(mesh);
    }
  }
  scene.add(group);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fps = frames / fpsAccum;
      frames = 0;
      fpsAccum = 0;
    }
    group.rotation.y += dt * 0.3;
    controls.update();
    renderer.render(scene, camera);
    const info = renderer.info.render;
    overlay.textContent =
      `WebGPU spike — backend: ${backendName}\n` +
      `fps: ${fps.toFixed(0)}\n` +
      `draw calls: ${info.drawCalls}\n` +
      `triangles: ${info.triangles.toLocaleString()}`;
  });
}
