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
import { buildWorldAsync } from "./quadtree.js";
import { meshChunk } from "./terrain.js";
import { ClodPageNode, PageMesh } from "./types.js";
import { createTerrainMaterial } from "./material.js";
import { selectCut, SelectionParams, SelectionState } from "./selection.js";
import { borderChain } from "./validate.js";

const LOD_COLORS = [0xffffff, 0x3a6ea5, 0x49a078, 0xd98032];
const WORLD_OPTIONS = [2, 4, 8, 16, 32];
const MAX_TERRAIN_TEXTURES = 4;
const TERRAIN_TEXTURE_BANDS = ["low", "mid low", "mid high", "high"];
const DEFAULT_TEXTURE_RANGES = [
  [14, 42],
  [42, 70],
  [70, 94],
  [94, 118],
] as const;
const SUN_DIRECTION = new THREE.Vector3(-0.35, 0.82, 0.45).normalize();
const SUN_BASE_COLOR = new THREE.Color(0.95, 0.86, 0.68);
const SKY_LIGHT_BASE_COLOR = new THREE.Color(0.42, 0.48, 0.58);
const GROUND_LIGHT_BASE_COLOR = new THREE.Color(0.18, 0.16, 0.13);
const SKY_ZENITH_BASE_COLOR = new THREE.Color(0x476d9f);
const SKY_HORIZON_BASE_COLOR = new THREE.Color(0xbfc9d2);

function sunDirectionFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    Math.cos(azimuth) * horizontal,
    Math.sin(elevation),
    Math.sin(azimuth) * horizontal,
  ).normalize();
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.72));
    float sun = max(dot(dir, normalize(uSunDir)), 0.0);
    sky += uSunColor * pow(sun, 360.0);
    sky += uSunColor * 0.18 * pow(sun, 18.0);
    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createSkyDome(radius: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIRECTION.clone() },
      uZenith: { value: SKY_ZENITH_BASE_COLOR.clone() },
      uHorizon: { value: SKY_HORIZON_BASE_COLOR.clone() },
      uSunColor: { value: SUN_BASE_COLOR.clone() },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}

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

interface TextureSlot {
  texture: THREE.Texture | null;
  name: string;
  previewUrl: string | null;
  heightMin: number;
  heightMax: number;
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
  const buildProgress = document.getElementById("build-progress")!;
  const buildProgressBar = document.getElementById("build-progress-bar") as HTMLProgressElement;
  const buildProgressPhase = document.getElementById("build-progress-phase")!;
  const buildProgressPercent = document.getElementById("build-progress-percent")!;
  const cfg = parseConfig(configText);
  await initSimplifier();

  // World size via ?world=. 8x8 gives full LOD0..LOD3 depth for A3 / delta-2-3
  // inspection; 16/32 keep the same max LOD with more roots and can freeze the tab longer.
  const requested = Number(new URLSearchParams(location.search).get("world"));
  const WORLD = WORLD_OPTIONS.includes(requested) ? requested : 4;
  const buildNote =
    WORLD >= 16 ? " (large build, tab will freeze longer)" :
    WORLD >= 8 ? " (~8s, tab will freeze)" :
    "";
  info.textContent = `building ${WORLD}x${WORLD} world…${buildNote}`;
  buildProgress.hidden = false;
  buildProgressPhase.textContent = `building ${WORLD}x${WORLD}`;
  buildProgressPercent.textContent = "0%";
  buildProgressBar.value = 0;
  await new Promise((r) => setTimeout(r, 16));
  const result = await buildWorldAsync(WORLD, WORLD, cfg, ({ done, total, level, phase }) => {
    const fraction = total > 0 ? Math.min(1, done / total) : 0;
    buildProgressBar.value = fraction;
    buildProgressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    buildProgressPhase.textContent = `${phase}  L${level}  ${done}/${total}`;
    info.textContent = `building ${WORLD}x${WORLD} world… ${Math.floor(fraction * 100)}%\n${phase}  L${level}  ${done}/${total}`;
  });
  buildProgress.hidden = true;
  const allNodes: ClodPageNode[] = [...result.nodesByLevel.values()].flat();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb1cf);
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const skyDome = createSkyDome(Math.max(1600, worldCells * 5));
  scene.add(skyDome);
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);

  const textureSlots: TextureSlot[] = Array.from({ length: MAX_TERRAIN_TEXTURES }, () => ({
    texture: null,
    name: "empty",
    previewUrl: null,
    heightMin: 0,
    heightMax: 0,
  }));
  for (let i = 0; i < textureSlots.length; i++) {
    textureSlots[i].heightMin = DEFAULT_TEXTURE_RANGES[i][0];
    textureSlots[i].heightMax = DEFAULT_TEXTURE_RANGES[i][1];
  }
  let activeTerrainSlots: TextureSlot[] = [];
  const rebuildActiveTerrainSlots = () => {
    activeTerrainSlots = textureSlots.filter((slot) => slot.texture !== null);
  };
  const applyTerrainTextures = () => {
    rebuildActiveTerrainSlots();
    const enabled = state.useTexture && activeTerrainSlots.length > 0;
    const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
    const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
    const apply = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.uUseTexture.value = enabled;
      mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
      mat.uniforms.uTextureScale.value = state.textureScale;
      for (let i = 0; i < textureUniforms.length; i++) {
        const slot = activeTerrainSlots[i];
        mat.uniforms[textureUniforms[i]].value = slot?.texture ?? null;
        mat.uniforms[rangeUniforms[i]].value.set(slot?.heightMin ?? 0, slot?.heightMax ?? 0);
      }
    };
    for (const v of views.values()) {
      apply(v.mat);
    }
    for (const { mats } of chunkGroups.values()) {
      for (const m of mats) {
        apply(m);
      }
    }
  };

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
        rebuildActiveTerrainSlots();
        const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
        const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
        mat.uniforms.uUseTexture.value = state.useTexture && activeTerrainSlots.length > 0;
        mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
        mat.uniforms.uTextureScale.value = state.textureScale;
        for (let ti = 0; ti < textureUniforms.length; ti++) {
          const slot = activeTerrainSlots[ti];
          mat.uniforms[textureUniforms[ti]].value = slot?.texture ?? null;
          mat.uniforms[rangeUniforms[ti]].value.set(slot?.heightMin ?? 0, slot?.heightMax ?? 0);
        }
        applyLightingToMaterial(mat);
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
    useTexture: false,
    textureScale: 1 / 64,
    loadedTextureFiles: "none",
    sunAzimuthDeg: 128,
    sunElevationDeg: 55,
    sunIntensity: 1,
    skyIntensity: 1,
    groundIntensity: 1,
    exposure: 1.05,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
  };
  let selState: SelectionState = { split: new Set() };
  const crossfadeStep = 1 / cfg.selection.crossfade_frames;
  const applyLightingToMaterial = (mat: THREE.ShaderMaterial) => {
    const sunDirection = sunDirectionFromAngles(state.sunAzimuthDeg, state.sunElevationDeg);
    mat.uniforms.uLight.value.copy(sunDirection);
    mat.uniforms.uSunColor.value.copy(SUN_BASE_COLOR).multiplyScalar(state.sunIntensity);
    mat.uniforms.uSkyLight.value.copy(SKY_LIGHT_BASE_COLOR).multiplyScalar(state.skyIntensity);
    mat.uniforms.uGroundLight.value.copy(GROUND_LIGHT_BASE_COLOR).multiplyScalar(state.groundIntensity);
  };
  const updateLighting = () => {
    const sunDirection = sunDirectionFromAngles(state.sunAzimuthDeg, state.sunElevationDeg);
    renderer.toneMappingExposure = state.exposure;
    const skyMat = skyDome.material as THREE.ShaderMaterial;
    skyMat.uniforms.uSunDir.value.copy(sunDirection);
    skyMat.uniforms.uSunColor.value.copy(SUN_BASE_COLOR).multiplyScalar(state.sunIntensity);
    skyMat.uniforms.uZenith.value.copy(SKY_ZENITH_BASE_COLOR).multiplyScalar(state.skyIntensity);
    skyMat.uniforms.uHorizon.value.copy(SKY_HORIZON_BASE_COLOR).multiplyScalar(state.skyIntensity);
    for (const v of views.values()) applyLightingToMaterial(v.mat);
    for (const { mats } of chunkGroups.values()) for (const m of mats) applyLightingToMaterial(m);
  };

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
  let lastNearFieldForced = 0;
  let lastRenderedCount = 0;
  let lastLevelSummary = "";
  let lastTriCount = 0;
  let averageFps = 0;

  const updateInfo = () => {
    info.textContent =
      `CLOD Pages PoC — Phase 2 runtime — ${WORLD}x${WORLD} pages\n` +
      `cut: ${lastRenderedCount} nodes  (${lastLevelSummary})\n` +
      `tris rendered: ${lastTriCount.toLocaleString()}   2:1 forced splits: ${lastForced}   ` +
      `bubble forced splits: ${lastNearFieldForced}\n` +
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${averageFps.toFixed(1)}   ` +
      `${state.freeze ? "[FROZEN]" : ""}`;
  };

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
    lastNearFieldForced = nearFieldForcedSplits;

    const cutIds = new Set(rendered.map((n) => n.id));
    for (const v of views.values()) v.target = cutIds.has(v.node.id) ? 1 : 0;

    const perLevel = new Map<number, number>();
    let tris = 0;
    for (const n of rendered) {
      perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
      tris += n.mesh.indices.length / 3;
    }
    lastRenderedCount = rendered.length;
    lastLevelSummary = [...perLevel.keys()].sort().map((l) => `L${l}:${perLevel.get(l)}`).join("  ");
    lastTriCount = tris;

    const cutKey = [...cutIds].sort().join("|");
    if (cutKey !== lastCutKey) {
      lastCutKey = cutKey;
      updateInfo();
    }
    const debugKey = `${cutKey}|bounds:${state.showBounds}|seams:${state.showSeamPoints}`;
    if (debugKey !== lastDebugKey) {
      lastDebugKey = debugKey;
      rebuildDebugOverlays(rendered);
    }
  };

  updateLighting();
  updateSelection();

  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  const updateAverageFps = () => {
    const now = performance.now();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    if (dt <= 0) return;

    fpsSamples.push(1000 / dt);
    if (fpsSamples.length > 120) fpsSamples.shift();
    averageFps = fpsSamples.reduce((sum, fps) => sum + fps, 0) / fpsSamples.length;

    if (now - lastFpsRefreshAt >= 250) {
      lastFpsRefreshAt = now;
      updateInfo();
    }
  };

  const gui = new GUI();
  gui
    .add({ world: String(WORLD) }, "world", WORLD_OPTIONS.map(String))
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
  const lightFolder = gui.addFolder("sky + light");
  lightFolder.add(state, "sunAzimuthDeg", 0, 360, 1).name("sun azimuth").onChange(updateLighting);
  lightFolder.add(state, "sunElevationDeg", 5, 85, 1).name("sun elevation").onChange(updateLighting);
  lightFolder.add(state, "sunIntensity", 0, 2.5, 0.05).name("sun intensity").onChange(updateLighting);
  lightFolder.add(state, "skyIntensity", 0, 2, 0.05).name("sky fill").onChange(updateLighting);
  lightFolder.add(state, "groundIntensity", 0, 2, 0.05).name("ground fill").onChange(updateLighting);
  lightFolder.add(state, "exposure", 0.4, 2, 0.05).name("exposure").onChange(updateLighting);
  const textureInput = document.createElement("input");
  textureInput.type = "file";
  textureInput.accept = "image/*";
  textureInput.multiple = true;
  textureInput.style.display = "none";
  document.body.appendChild(textureInput);
  let pendingTextureLoad: number | "all" | null = null;
  const slotCards: HTMLElement[] = [];
  let loadedTextureController: { updateDisplay: () => unknown } | null = null;
  let useTextureController: { updateDisplay: () => unknown } | null = null;
  let textureScaleController: { updateDisplay: () => unknown } | null = null;
  let syncTextureModalControls = () => {};

  const updateLoadedTextureDisplay = () => {
    const loaded = textureSlots
      .map((slot, index) => (slot.texture ? `${TERRAIN_TEXTURE_BANDS[index]}: ${slot.name}` : ""))
      .filter(Boolean);
    state.loadedTextureFiles = loaded.length > 0 ? loaded.join(" | ") : "none";
    loadedTextureController?.updateDisplay();
  };
  const updateTextureSlotPreview = (index: number) => {
    const card = slotCards[index];
    if (!card) return;
    const slot = textureSlots[index];
    const preview = card.querySelector<HTMLElement>(".texture-preview");
    const name = card.querySelector<HTMLElement>(".texture-slot-name");
    if (preview) {
      preview.style.backgroundImage = slot.previewUrl ? `url("${slot.previewUrl}")` : "";
      preview.textContent = slot.previewUrl ? "" : TERRAIN_TEXTURE_BANDS[index];
    }
    if (name) name.textContent = slot.texture ? slot.name : "empty";
    card.title = `${TERRAIN_TEXTURE_BANDS[index]} height texture`;
  };
  const updateTextureSlotPreviews = () => {
    for (let i = 0; i < textureSlots.length; i++) updateTextureSlotPreview(i);
  };
  const refreshTextureState = () => {
    updateLoadedTextureDisplay();
    updateTextureSlotPreviews();
    useTextureController?.updateDisplay();
    textureScaleController?.updateDisplay();
    syncTextureModalControls();
    applyTerrainTextures();
  };
  const setTextureSlot = (index: number, texture: THREE.Texture, name: string, previewUrl: string) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = { ...old, texture, name, previewUrl };
  };
  const clearTextureSlot = (index: number) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = { ...old, texture: null, name: "empty", previewUrl: null };
  };
  const clearAllTextures = () => {
    for (let i = 0; i < textureSlots.length; i++) clearTextureSlot(i);
    state.useTexture = false;
    refreshTextureState();
  };
  const textureActions = {
    loadTexture: () => {
      syncTextureModalControls();
      updateTextureSlotPreviews();
      textureModal.hidden = false;
    },
    clearTexture: clearAllTextures,
  };
  const loadTerrainTexture = (file: File): Promise<{ texture: THREE.Texture; previewUrl: string } | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          texture.needsUpdate = true;
          resolve({ texture, previewUrl: url });
        },
        undefined,
        () => {
          URL.revokeObjectURL(url);
          resolve(null);
        },
      );
    });
  textureInput.addEventListener("change", async () => {
    const files = Array.from(textureInput.files ?? []);
    if (files.length === 0) return;
    if (pendingTextureLoad === "all") {
      const loaded = await Promise.all(files.slice(0, MAX_TERRAIN_TEXTURES).map(loadTerrainTexture));
      loaded.forEach((result, index) => {
        if (result) setTextureSlot(index, result.texture, files[index].name, result.previewUrl);
      });
    } else if (typeof pendingTextureLoad === "number") {
      const result = await loadTerrainTexture(files[0]);
      if (result) setTextureSlot(pendingTextureLoad, result.texture, files[0].name, result.previewUrl);
    }
    pendingTextureLoad = null;
    if (textureSlots.some((slot) => slot.texture)) {
      state.useTexture = true;
    }
    refreshTextureState();
    textureInput.value = "";
  });

  const textureModal = document.createElement("div");
  textureModal.id = "texture-modal";
  textureModal.hidden = true;
  textureModal.innerHTML = `
    <section class="texture-panel" role="dialog" aria-modal="true" aria-labelledby="texture-modal-title">
      <header>
        <h2 id="texture-modal-title">Terrain textures</h2>
        <button type="button" data-texture-close>Close</button>
      </header>
      <div class="texture-panel-body">
        <div class="texture-slot-grid"></div>
        <div class="texture-controls">
          <label><span>Enable texture</span><input data-texture-enabled type="checkbox" /></label>
          <label><span>Texture scale <output data-texture-scale-value></output></span><input data-texture-scale type="range" min="${1 / 512}" max="${1 / 8}" step="${1 / 512}" /></label>
        </div>
        <div class="texture-actions">
          <button type="button" data-texture-load-all>Load all</button>
          <button type="button" data-texture-clear>Clear</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(textureModal);
  const slotGrid = textureModal.querySelector<HTMLElement>(".texture-slot-grid")!;
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const card = document.createElement("article");
    card.className = "texture-slot";
    card.innerHTML = `
      <button class="texture-preview" type="button">${TERRAIN_TEXTURE_BANDS[i]}</button>
      <span class="texture-slot-name">empty</span>
      <label class="texture-slot-param">Low <input data-slot-low="${i}" type="number" min="0" max="128" step="1" value="${textureSlots[i].heightMin}" /></label>
      <label class="texture-slot-param">High <input data-slot-high="${i}" type="number" min="0" max="128" step="1" value="${textureSlots[i].heightMax}" /></label>
    `;
    card.querySelector(".texture-preview")!.addEventListener("click", () => {
      pendingTextureLoad = i;
      textureInput.multiple = false;
      textureInput.click();
    });
    slotCards.push(card);
    slotGrid.appendChild(card);
  }
  const enabledInput = textureModal.querySelector<HTMLInputElement>("[data-texture-enabled]")!;
  const scaleInput = textureModal.querySelector<HTMLInputElement>("[data-texture-scale]")!;
  const scaleValue = textureModal.querySelector<HTMLOutputElement>("[data-texture-scale-value]")!;
  syncTextureModalControls = () => {
    enabledInput.checked = state.useTexture;
    scaleInput.value = String(state.textureScale);
    scaleValue.value = state.textureScale.toFixed(4);
    for (let i = 0; i < textureSlots.length; i++) {
      const low = textureModal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`);
      const high = textureModal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`);
      if (low) low.value = String(textureSlots[i].heightMin);
      if (high) high.value = String(textureSlots[i].heightMax);
    }
  };
  enabledInput.addEventListener("change", () => {
    state.useTexture = enabledInput.checked;
    refreshTextureState();
  });
  scaleInput.addEventListener("input", () => {
    state.textureScale = Number(scaleInput.value);
    scaleValue.value = state.textureScale.toFixed(4);
    refreshTextureState();
  });
  for (let i = 0; i < textureSlots.length; i++) {
    textureModal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`)!.addEventListener("change", (event) => {
      textureSlots[i].heightMin = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    });
    textureModal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`)!.addEventListener("change", (event) => {
      textureSlots[i].heightMax = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    });
  }
  textureModal.querySelector<HTMLElement>("[data-texture-load-all]")!.addEventListener("click", () => {
    pendingTextureLoad = "all";
    textureInput.multiple = true;
    textureInput.click();
  });
  textureModal.querySelector<HTMLElement>("[data-texture-clear]")!.addEventListener("click", clearAllTextures);
  textureModal.querySelector<HTMLElement>("[data-texture-close]")!.addEventListener("click", () => {
    textureModal.hidden = true;
  });
  textureModal.addEventListener("click", (event) => {
    if (event.target === textureModal) textureModal.hidden = true;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") textureModal.hidden = true;
  });
  syncTextureModalControls();
  updateTextureSlotPreviews();

  const textureFolder = gui.addFolder("terrain texture");
  textureFolder.add(textureActions, "loadTexture").name("load image files");
  useTextureController = textureFolder.add(state, "useTexture").name("enable texture").onChange((on: boolean) => {
    state.useTexture = on;
    syncTextureModalControls();
    applyTerrainTextures();
  });
  textureScaleController = textureFolder.add(state, "textureScale", 1 / 512, 1 / 8, 1 / 512).name("texture scale").onChange((scale: number) => {
    state.textureScale = scale;
    syncTextureModalControls();
    applyTerrainTextures();
  });
  loadedTextureController = textureFolder.add(state, "loadedTextureFiles").name("loaded").disable();
  textureFolder.add(textureActions, "clearTexture").name("clear texture");
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
    updateAverageFps();
    skyDome.position.copy(camera.position);
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
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  console.error(e);
});
