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
import { meshChunk } from "./terrain.js";
import { ClodPageNode, PageMesh } from "./types.js";
import { createTerrainMaterial } from "./material.js";
import { selectCut, SelectionParams, SelectionState } from "./selection.js";

const LOD_COLORS = [0xffffff, 0x3a6ea5, 0x49a078, 0xd98032];

function toGeometry(mesh: PageMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
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

  // World size via ?world= (2/4/8). 8x8 gives full LOD0..LOD3 depth for A3 / delta-2-3
  // inspection but takes a few seconds and briefly freezes the tab while it builds.
  const requested = Number(new URLSearchParams(location.search).get("world"));
  const WORLD = [2, 4, 8].includes(requested) ? requested : 4;
  info.textContent = `building ${WORLD}x${WORLD} world…${WORLD >= 8 ? " (~8s, tab will freeze)" : ""}`;
  await new Promise((r) => setTimeout(r, 16));
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
    const mesh = new THREE.Mesh(toGeometry(node.mesh), mat);
    mesh.visible = false;
    scene.add(mesh);
    views.set(node.id, { node, mesh, mat, fade: 0, target: 0 });
  }

  // page-boundary overlay (rebuilt on cut change)
  const boundaryGroup = new THREE.Group();
  scene.add(boundaryGroup);

  // Near-field bubble: raw per-chunk meshes for a LOD0 page, built lazily and cached.
  // Page LOD0 = welded chunks, so with tint off the bubble edge must be invisible (§4.4).
  const worldBounds = { cellsX: worldCells, cellsZ: worldCells };
  const P = cfg.page.chunks_per_page;
  const chunkGroups = new Map<string, { group: THREE.Group; mats: THREE.ShaderMaterial[] }>();
  const ensureChunkGroup = (node: ClodPageNode) => {
    let entry = chunkGroups.get(node.id);
    if (entry) return entry;
    const [px, pz] = node.id.slice(3).split(",").map(Number);
    const group = new THREE.Group();
    const mats: THREE.ShaderMaterial[] = [];
    for (let dz = 0; dz < P; dz++) {
      for (let dx = 0; dx < P; dx++) {
        const cm = meshChunk(px * P + dx, pz * P + dz, cfg, worldBounds);
        const mat = createTerrainMaterial(state.tintBubble ? 0xc94b4b : 0xffffff);
        group.add(new THREE.Mesh(toGeometry(cm), mat));
        mats.push(mat);
      }
    }
    scene.add(group);
    entry = { group, mats };
    chunkGroups.set(node.id, entry);
    return entry;
  };

  const state = {
    thresholdPx: cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    colorByLod: true,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
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
  gui
    .add({ world: String(WORLD) }, "world", ["2", "4", "8"])
    .name("world size (reloads)")
    .onChange((w: string) => {
      location.search = `?world=${w}`;
    });
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
  const bubbleFolder = gui.addFolder("near-field bubble (§4.4)");
  bubbleFolder.add(state, "bubble").name("enable (raw chunks)");
  bubbleFolder.add(state, "bubbleRadius", 16, 160, 1).name("radius (cells)");
  bubbleFolder.add(state, "tintBubble").name("tint bubble red").onChange((on: boolean) => {
    for (const { mats } of chunkGroups.values())
      for (const m of mats) (m.uniforms.uColor.value as THREE.Color).set(on ? 0xc94b4b : 0xffffff);
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

    // Near-field bubble: a LOD0 page within the radius is owned by its raw chunks instead.
    // Binary per-page ownership (no overlap band) — both draw the same welded surface.
    for (const v of views.values()) {
      const owned =
        state.bubble &&
        v.node.level === 0 &&
        v.target === 1 &&
        Math.hypot(
          controls.target.x - (v.node.footprint.minX + v.node.footprint.maxX) / 2,
          controls.target.z - (v.node.footprint.minZ + v.node.footprint.maxZ) / 2,
        ) < state.bubbleRadius;
      if (owned) {
        v.mesh.visible = false;
        ensureChunkGroup(v.node).group.visible = true;
      } else {
        const grp = chunkGroups.get(v.node.id);
        if (grp) grp.group.visible = false;
      }
    }
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  console.error(e);
});
