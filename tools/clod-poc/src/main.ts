// Phase 2 runtime viewer. Plan §4.
//
// Per-frame DAG-cut selection (errorPx + hysteresis + optional 2:1), dithered crossfade on
// cut changes, and debug overlays. The full Phase 3 stress scenes / near-field bubble mask
// (§4.4) and floating per-node error labels / locked-border highlight are not built yet.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "lil-gui";
import { parseConfig } from "./config.js";
import configText from "../../../config/clod_pages.yaml?raw";
import { initSimplifier } from "./simplify.js";
import { buildWorld } from "./quadtree.js";
import { ClodPageNode } from "./types.js";
import { createTerrainMaterial } from "./material.js";
import { selectCut, SelectionParams, SelectionState } from "./selection.js";

const LOD_COLORS = [0xffffff, 0x3a6ea5, 0x49a078, 0xd98032];

function toGeometry(node: ClodPageNode): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(node.mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(node.mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(node.mesh.indices, 1));
  return g;
}

interface NodeView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  fade: number; // current crossfade value
  target: number; // 0 or 1
}

async function main() {
  const info = document.getElementById("info")!;
  const cfg = parseConfig(configText);
  await initSimplifier();

  const WORLD = 4; // 4x4 LOD0 pages -> levels 0..2, a meaningful cut without a long build
  info.textContent = "building quadtree…";
  await new Promise((r) => setTimeout(r, 0));
  const result = buildWorld(WORLD, WORLD, cfg);
  const allNodes: ClodPageNode[] = [...result.nodesByLevel.values()].flat();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d22);
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);

  // One view per node; visibility/fade drive what's drawn.
  const views = new Map<string, NodeView>();
  for (const node of allNodes) {
    const mat = createTerrainMaterial(LOD_COLORS[Math.min(node.level, LOD_COLORS.length - 1)]);
    const mesh = new THREE.Mesh(toGeometry(node), mat);
    mesh.visible = false;
    scene.add(mesh);
    views.set(node.id, { node, mesh, mat, fade: 0, target: 0 });
  }

  // page-boundary overlay (rebuilt on cut change)
  const boundaryGroup = new THREE.Group();
  scene.add(boundaryGroup);

  const state = {
    thresholdPx: cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    colorByLod: true,
  };
  let selState: SelectionState = { split: new Set() };
  const crossfadeStep = 1 / cfg.selection.crossfade_frames;

  const rebuildBounds = (rendered: ClodPageNode[]) => {
    boundaryGroup.clear();
    if (!state.showBounds) return;
    for (const n of rendered) {
      const box = new THREE.Box3(
        new THREE.Vector3(n.footprint.minX, n.bounds.center[1] - n.bounds.radius, n.footprint.minZ),
        new THREE.Vector3(n.footprint.maxX, n.bounds.center[1] + n.bounds.radius, n.footprint.maxZ),
      );
      boundaryGroup.add(new THREE.Box3Helper(box, new THREE.Color(LOD_COLORS[Math.min(n.level, 3)])));
    }
  };

  let lastCutKey = "";
  let lastForced = 0;

  const updateSelection = () => {
    const params: SelectionParams = {
      thresholdPx: state.thresholdPx,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      enforce21: state.enforce21,
      viewportH: renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(camera.fov),
      camPos: [camera.position.x, camera.position.y, camera.position.z],
    };
    const { rendered, state: ns, forcedSplits } = selectCut(result.roots, params, selState);
    selState = ns;
    lastForced = forcedSplits;

    const cutIds = new Set(rendered.map((n) => n.id));
    for (const v of views.values()) v.target = cutIds.has(v.node.id) ? 1 : 0;

    const cutKey = [...cutIds].sort().join("|");
    if (cutKey !== lastCutKey) {
      lastCutKey = cutKey;
      rebuildBounds(rendered);
      const perLevel = new Map<number, number>();
      let tris = 0;
      for (const n of rendered) {
        perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
        tris += n.mesh.indices.length / 3;
      }
      const levels = [...perLevel.keys()].sort().map((l) => `L${l}:${perLevel.get(l)}`).join("  ");
      info.textContent =
        `CLOD Pages PoC — Phase 2 runtime — ${WORLD}x${WORLD} pages\n` +
        `cut: ${rendered.length} nodes  (${levels})\n` +
        `tris rendered: ${tris.toLocaleString()}   2:1 forced splits: ${lastForced}\n` +
        `threshold: ${state.thresholdPx.toFixed(2)} px   ${state.freeze ? "[FROZEN]" : ""}`;
    }
  };

  updateSelection();

  const gui = new GUI();
  gui.add(state, "thresholdPx", 0.1, 6, 0.05).name("error threshold px").onChange(updateSelection);
  gui.add(state, "enforce21").name("2:1 constraint").onChange(updateSelection);
  gui.add(state, "freeze").name("freeze selection");
  gui.add(state, "showBounds").name("page boundaries").onChange(updateSelection);
  gui.add(state, "wireframe").name("wireframe").onChange((on: boolean) => {
    for (const v of views.values()) v.mat.wireframe = on;
  });
  gui.add(state, "colorByLod").name("color by LOD").onChange((on: boolean) => {
    for (const v of views.values()) {
      const c = on ? LOD_COLORS[Math.min(v.node.level, 3)] : 0xb9c0c8;
      (v.mat.uniforms.uColor.value as THREE.Color).set(c);
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    if (!state.freeze) updateSelection();

    // advance crossfades
    for (const v of views.values()) {
      if (v.fade < v.target) v.fade = Math.min(v.target, v.fade + crossfadeStep);
      else if (v.fade > v.target) v.fade = Math.max(v.target, v.fade - crossfadeStep);
      v.mesh.visible = v.fade > 0.001;
      v.mat.uniforms.uFade.value = v.fade;
      v.mat.uniforms.uDither.value = v.fade < 0.999;
    }
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  console.error(e);
});
