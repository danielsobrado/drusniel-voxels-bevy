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
import { borderChain } from "./validate.js";

const LOD_COLORS = [0xffffff, 0x3a6ea5, 0x49a078, 0xd98032];

function toGeometry(mesh: PageMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

function computeGeometryNormals(mesh: PageMesh): Float32Array {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  const normals = (g.getAttribute("normal").array as Float32Array).slice();
  g.dispose();
  return normals;
}

interface NodeView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sourceNormals: Float32Array;
  recomputedNormals: Float32Array;
  fade: number; // current crossfade value
  target: number; // 0 or 1
}

function sharedEdge(a: ClodPageNode, b: ClodPageNode): { axis: "x" | "z"; aPlane: number; bPlane: number } | null {
  const fa = a.footprint, fb = b.footprint;
  const overlapZ = fa.minZ < fb.maxZ && fb.minZ < fa.maxZ;
  const overlapX = fa.minX < fb.maxX && fb.minX < fa.maxX;
  if (overlapZ) {
    if (fa.maxX === fb.minX) return { axis: "x", aPlane: fa.maxX, bPlane: fb.minX };
    if (fb.maxX === fa.minX) return { axis: "x", aPlane: fa.minX, bPlane: fb.maxX };
  }
  if (overlapX) {
    if (fa.maxZ === fb.minZ) return { axis: "z", aPlane: fa.maxZ, bPlane: fb.minZ };
    if (fb.maxZ === fa.minZ) return { axis: "z", aPlane: fa.minZ, bPlane: fb.maxZ };
  }
  return null;
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
    views.set(node.id, {
      node,
      mesh,
      mat,
      sourceNormals: node.mesh.normals,
      recomputedNormals: computeGeometryNormals(node.mesh),
      fade: 0,
      target: 0,
    });
  }

  // page-boundary overlay (rebuilt on cut change)
  const boundaryGroup = new THREE.Group();
  scene.add(boundaryGroup);
  const seamGroup = new THREE.Group();
  scene.add(seamGroup);

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
        mat.uniforms.uNormalColor.value = state.normalColor;
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
    showSeamPoints: false,
    colorByLod: true,
    normalColor: false,
    recomputedNormals: false,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
  };
  let selState: SelectionState = { split: new Set() };
  const crossfadeStep = 1 / cfg.selection.crossfade_frames;

  const rebuildDebugOverlays = (rendered: ClodPageNode[]) => {
    boundaryGroup.clear();
    if (state.showBounds) {
      for (const n of rendered) {
        const box = new THREE.Box3(
          new THREE.Vector3(n.footprint.minX, n.bounds.center[1] - n.bounds.radius, n.footprint.minZ),
          new THREE.Vector3(n.footprint.maxX, n.bounds.center[1] + n.bounds.radius, n.footprint.maxZ),
        );
        boundaryGroup.add(new THREE.Box3Helper(box, new THREE.Color(LOD_COLORS[Math.min(n.level, 3)])));
      }
    }

    seamGroup.clear();
    if (!state.showSeamPoints) return;
    const pts: number[] = [];
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        const a = rendered[i], b = rendered[j];
        if (a.level !== b.level) continue;
        const edge = sharedEdge(a, b);
        if (!edge) continue;
        const ca = borderChain(a.mesh, edge.axis, edge.aPlane, a.footprint);
        const cb = borderChain(b.mesh, edge.axis, edge.bPlane, b.footprint);
        for (const p of ca.positions) pts.push(p[0], p[1], p[2]);
        for (const p of cb.positions) pts.push(p[0], p[1], p[2]);
      }
    }
    if (pts.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.PointsMaterial({
        color: 0xff2448,
        size: 4,
        sizeAttenuation: false,
        depthTest: false,
      });
      const pointCloud = new THREE.Points(geom, mat);
      pointCloud.renderOrder = 20;
      seamGroup.add(pointCloud);
    }
  };

  let lastCutKey = "";
  let lastDebugKey = "";
  let lastForced = 0;

  const updateSelection = () => {
    const params: SelectionParams = {
      thresholdPx: state.thresholdPx,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      enforce21: state.enforce21,
      nearField: {
        enabled: state.bubble,
        centerX: controls.target.x,
        centerZ: controls.target.z,
        radius: state.bubbleRadius,
        boundaryPadding: cfg.page.chunks_per_page * cfg.page.chunk_size,
      },
      viewportH: renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(camera.fov),
      camPos: [camera.position.x, camera.position.y, camera.position.z],
    };
    const { rendered, state: ns, forcedSplits, nearFieldForcedSplits } = selectCut(result.roots, params, selState);
    selState = ns;
    lastForced = forcedSplits;

    const cutIds = new Set(rendered.map((n) => n.id));
    for (const v of views.values()) v.target = cutIds.has(v.node.id) ? 1 : 0;

    const cutKey = [...cutIds].sort().join("|");
    if (cutKey !== lastCutKey) {
      lastCutKey = cutKey;
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
        `tris rendered: ${tris.toLocaleString()}   2:1 forced splits: ${lastForced}   ` +
        `bubble forced splits: ${nearFieldForcedSplits}\n` +
        `threshold: ${state.thresholdPx.toFixed(2)} px   ${state.freeze ? "[FROZEN]" : ""}`;
    }
    const debugKey = `${cutKey}|bounds:${state.showBounds}|seams:${state.showSeamPoints}`;
    if (debugKey !== lastDebugKey) {
      lastDebugKey = debugKey;
      rebuildDebugOverlays(rendered);
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
  gui.add(state, "showSeamPoints").name("same-LOD seam points").onChange(updateSelection);
  gui.add(state, "wireframe").name("wireframe").onChange((on: boolean) => {
    for (const v of views.values()) v.mat.wireframe = on;
  });
  gui.add(state, "normalColor").name("normal colours").onChange((on: boolean) => {
    for (const v of views.values()) v.mat.uniforms.uNormalColor.value = on;
    for (const { mats } of chunkGroups.values()) for (const m of mats) m.uniforms.uNormalColor.value = on;
  });
  gui.add(state, "recomputedNormals").name("recomputed normals").onChange((on: boolean) => {
    for (const v of views.values()) {
      const g = v.mesh.geometry as THREE.BufferGeometry;
      g.setAttribute("normal", new THREE.BufferAttribute(on ? v.recomputedNormals : v.sourceNormals, 3));
      g.attributes.normal.needsUpdate = true;
    }
  });
  gui.add(state, "colorByLod").name("color by LOD").onChange((on: boolean) => {
    for (const v of views.values()) {
      const c = on ? LOD_COLORS[Math.min(v.node.level, 3)] : 0xb9c0c8;
      (v.mat.uniforms.uColor.value as THREE.Color).set(c);
    }
  });
  const bubbleFolder = gui.addFolder("near-field bubble (§4.4)");
  bubbleFolder.add(state, "bubble").name("enable (raw chunks)").onChange(updateSelection);
  bubbleFolder.add(state, "bubbleRadius", 16, 160, 1).name("radius (cells)").onChange(updateSelection);
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
