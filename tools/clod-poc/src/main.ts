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
import {
  buildNodeIndex,
  buildWorldAsync,
  rebuildDirtyLod0Pages,
  resimplifyParent,
  type NodeIndex,
} from "./quadtree.js";
import {
  addDigEdit,
  type BrushOp,
  type BrushShape,
  digEditCount,
  DIG_INFLUENCE_MARGIN,
  getDigEditsSnapshot,
  meshChunk,
  replaceDigEdits,
} from "./terrain.js";
import { ClodPageNode, PageMesh } from "./types.js";
import {
  applyTerrainColorAdjustments,
  createTerrainMaterial,
  DEFAULT_TERRAIN_COLOR_ADJUSTMENTS,
  type TerrainColorAdjustments,
} from "./material.js";
import {
  DEFAULT_GRASS_SETTINGS,
  GrassSystem,
  type GrassLighting,
  type GrassSettings,
} from "./grass.js";
import {
  DEFAULT_PLAYER_CONFIG,
  PlayerController,
  PlayerInteractionState,
  type PlayerInputState,
} from "./player_controller.js";
import { selectCut, SelectionParams, SelectionState } from "./selection.js";
import { TerrainColliderSet, type TerrainColliderPage, type TerrainSurfaceHit } from "./terrain_collider.js";
import { borderChain } from "./validate.js";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  SkyEnvironment,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "./environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  PostProcessPipeline,
  type PostProcessSettings,
} from "./postprocess.js";
import {
  consumeStagedProjectImport,
  createProjectArchive,
  parseProjectArchive,
  PROJECT_SCHEMA_VERSION,
  stageProjectImport,
  type ClodProjectManifestV1,
  type ProjectArchiveContents,
  type ProjectSessionState,
  type ProjectTextureSlot,
  type TextureBlendMode,
} from "./project_archive.js";

const LOD_COLORS = [0x9ca3ad, 0x3a6ea5, 0x49a078, 0xd98032];
const WORLD_OPTIONS = [2, 4, 8, 16, 32];
const MAX_TERRAIN_TEXTURES = 4;
const TERRAIN_TEXTURE_BANDS = ["low", "mid low", "mid high", "high"];
const DEFAULT_TERRAIN_TEXTURE_PRESETS = [
  { id: "grass-2", scale: 0.06, heightMin: 12, heightMax: 18 },
  { id: "earth-2", scale: 0.04, heightMin: 18, heightMax: 40 },
  { id: "earth-1", scale: 0.04, heightMin: 40, heightMax: 60 },
  { id: "snow-rocks-1", scale: 0.025, heightMin: 60, heightMax: 118 },
] as const;
const DEMO_TEXTURE_BASE_URL =
  "https://raw.githubusercontent.com/danielsobrado/drusniel-voxels-bevy/main/tools/clod-poc/textures/";
const demoTextureUrl = (file: string) => `${DEMO_TEXTURE_BASE_URL}${file}`;
const BUILTIN_TERRAIN_TEXTURES = [
  { id: "earth-1", label: "Earth 1", url: demoTextureUrl("earth-1.jpg") },
  { id: "earth-2", label: "Earth 2", url: demoTextureUrl("earth-2.jpg") },
  { id: "grass-1", label: "Grass 1", url: demoTextureUrl("grass-1.jpg") },
  { id: "grass-2", label: "Grass 2", url: demoTextureUrl("grass-2.jpg") },
  { id: "cobblestone-1", label: "Cobblestone 1", url: demoTextureUrl("cobblestone-1.jpg") },
  { id: "cobblestone-2", label: "Cobblestone 2", url: demoTextureUrl("cobblestone-2.jpg") },
  { id: "bedrock-1", label: "Bedrock 1", url: demoTextureUrl("bedrock-1.jpg") },
  { id: "bedrock-2", label: "Bedrock 2", url: demoTextureUrl("bedrock-2.jpg") },
  { id: "sand-1", label: "Sand 1", url: demoTextureUrl("sand-1.jpg") },
  { id: "sand-2", label: "Sand 2", url: demoTextureUrl("sand-2.jpg") },
  { id: "terracotta-1", label: "Terracotta 1", url: demoTextureUrl("terracotta-1.jpg") },
  { id: "terracotta-2", label: "Terracotta 2", url: demoTextureUrl("terracotta-2.jpg") },
  { id: "water-1", label: "Water 1", url: demoTextureUrl("water-1.jpg") },
  { id: "water-2", label: "Water 2", url: demoTextureUrl("water-2.jpg") },
  { id: "oak-bark-1", label: "Oak bark 1", url: demoTextureUrl("oak-bark-1.jpg") },
  { id: "oak-bark-2", label: "Oak bark 2", url: demoTextureUrl("oak-bark-2.jpg") },
  { id: "oak-leaf-1", label: "Oak leaf 1", url: demoTextureUrl("oak-leaf-1.jpg") },
  { id: "oak-leaf-2", label: "Oak leaf 2", url: demoTextureUrl("oak-leaf-2.jpg") },
  { id: "snow-1", label: "Snow 1", url: demoTextureUrl("snow-1.jpg") },
  { id: "snow-rocks-1", label: "Snow rocks 1", url: demoTextureUrl("snow-rocks-1.jpg") },
] as const;
const TEXTURE_BLEND_MODES = ["hard bands", "blend bands"] as const;

function toGeometry(mesh: PageMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  // per-vertex paint slot for the terrain shader (zero = natural terrain, height-banded)
  g.setAttribute("material", new THREE.BufferAttribute(mesh.materials, 4));
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
  normalTexture: THREE.Texture | null;
  normalPreviewUrl: string | null;
  normalBytes: Uint8Array | null;
  normalMimeType: string | null;
  normalExtension: string | null;
  name: string;
  previewUrl: string | null;
  selectedId: string;
  customBytes: Uint8Array | null;
  customMimeType: string | null;
  customExtension: string | null;
  scale: number;
  heightMin: number;
  heightMax: number;
}

interface SharedEdge {
  axis: "x" | "z";
  aPlane: number;
  bPlane: number;
}

interface CrossLodAdjacency {
  a: ClodPageNode;
  b: ClodPageNode;
  edge: SharedEdge;
}

function sharedEdge(a: ClodPageNode, b: ClodPageNode): SharedEdge | null {
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

function crossLodAdjacencies(rendered: ClodPageNode[]): CrossLodAdjacency[] {
  const out: CrossLodAdjacency[] = [];
  for (let i = 0; i < rendered.length; i++) {
    for (let j = i + 1; j < rendered.length; j++) {
      const a = rendered[i], b = rendered[j];
      if (a.level === b.level) continue;
      const edge = sharedEdge(a, b);
      if (edge) out.push({ a, b, edge });
    }
  }
  return out;
}

function appendBorderChainSegments(
  pts: number[],
  node: ClodPageNode,
  axis: "x" | "z",
  plane: number,
  minAlong: number,
  maxAlong: number,
): void {
  const free = axis === "x" ? 2 : 0;
  const chain = borderChain(node.mesh, axis, plane, node.footprint).positions
    .filter((p) => p[free] >= minAlong - 0.001 && p[free] <= maxAlong + 0.001);
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i];
    pts.push(a[0], a[1] + 0.12, a[2], b[0], b[1] + 0.12, b[2]);
  }
}

function appendCrossLodBorderSegments(pts: number[], adjacency: CrossLodAdjacency): void {
  const { a, b, edge } = adjacency;
  if (edge.axis === "x") {
    const minZ = Math.max(a.footprint.minZ, b.footprint.minZ);
    const maxZ = Math.min(a.footprint.maxZ, b.footprint.maxZ);
    appendBorderChainSegments(pts, a, edge.axis, edge.aPlane, minZ, maxZ);
    appendBorderChainSegments(pts, b, edge.axis, edge.bPlane, minZ, maxZ);
  } else {
    const minX = Math.max(a.footprint.minX, b.footprint.minX);
    const maxX = Math.min(a.footprint.maxX, b.footprint.maxX);
    appendBorderChainSegments(pts, a, edge.axis, edge.aPlane, minX, maxX);
    appendBorderChainSegments(pts, b, edge.axis, edge.bPlane, minX, maxX);
  }
}

async function main() {
  const info = document.getElementById("info")!;
  const importButton = document.getElementById("project-import") as HTMLButtonElement;
  const exportButton = document.getElementById("project-export") as HTMLButtonElement;
  const projectImportInput = document.getElementById("project-import-input") as HTMLInputElement;
  const orbitModeButton = document.getElementById("orbit-mode") as HTMLButtonElement;
  const playerModeButton = document.getElementById("player-mode") as HTMLButtonElement;
  const playerModeStatus = document.getElementById("player-mode-status")!;
  const buildProgress = document.getElementById("build-progress")!;
  const buildProgressBar = document.getElementById("build-progress-bar") as HTMLProgressElement;
  const buildProgressPhase = document.getElementById("build-progress-phase")!;
  const buildProgressPercent = document.getElementById("build-progress-percent")!;
  const searchParams = new URLSearchParams(location.search);
  const importToken = searchParams.get("import");
  let stagedImport: ProjectArchiveContents | null = null;
  if (importToken) {
    buildProgress.hidden = false;
    buildProgressPhase.textContent = "loading imported project";
    buildProgressPercent.textContent = "0%";
    buildProgressBar.value = 0;
    try {
      stagedImport = await consumeStagedProjectImport(importToken);
      if (!stagedImport) throw new Error("The staged project was not found or was already used");
    } catch (error) {
      info.textContent = `Project import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      searchParams.delete("import");
      const query = searchParams.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }
  }
  const cfg = stagedImport?.manifest.config ?? parseConfig(configText);
  await initSimplifier();

  // World size via ?world=. 8x8 gives full LOD0..LOD3 depth for A3 / delta-2-3
  // inspection; 16/32 keep the same max LOD with more roots and can freeze the tab longer.
  const requested = Number(searchParams.get("world"));
  const WORLD = stagedImport?.manifest.worldSize ?? (WORLD_OPTIONS.includes(requested) ? requested : 4);
  if (stagedImport) replaceDigEdits(stagedImport.manifest.terrainEdits);
  const buildNote =
    WORLD >= 16 ? " (large build, tab will freeze longer)" :
    WORLD >= 8 ? " (~8s, tab will freeze)" :
    "";
  info.textContent = `building ${WORLD}x${WORLD} world…${buildNote}`;
  buildProgress.hidden = false;
  buildProgressPhase.textContent = `${stagedImport ? "import: " : ""}building ${WORLD}x${WORLD}`;
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
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);
  if (stagedImport) {
    camera.position.fromArray(stagedImport.manifest.camera.position);
    controls.target.fromArray(stagedImport.manifest.camera.target);
    camera.lookAt(controls.target);
    controls.update();
  }

  const colliderPages: TerrainColliderPage[] = allNodes
    .filter((node) => node.level === 0)
    .map((node) => ({
      id: node.id,
      geometry: toGeometry(node.mesh),
      footprint: node.footprint,
    }));
  const terrainColliders = new TerrainColliderSet(colliderPages);
  for (const page of colliderPages) page.geometry.dispose();
  const player = new PlayerController(terrainColliders, {
    minX: 0,
    minZ: 0,
    maxX: worldCells,
    maxZ: worldCells,
  });
  const interaction = new PlayerInteractionState();
  const playerInput: PlayerInputState = { forward: 0, right: 0, sprint: false, jump: false };
  const playerRaycaster = new THREE.Raycaster();
  const playerPointer = new THREE.Vector2();
  const playerForward = new THREE.Vector3();
  const orbitReturnTarget = new THREE.Vector3();
  const playerClock = new THREE.Clock();
  let playerYaw = 0;
  let playerPitch = 0;
  let playerPointerLocked = false;
  let tabUiHold = false;

  // Pickaxe state: hold-to-dig cadence while playing, hover preview in orbit mode.
  const DIG_HOLD_INTERVAL_MS = 400;
  let digHeld = false;
  let lastDigAt = -Infinity;
  const digDirection = new THREE.Vector3();
  const digAimRay = new THREE.Ray();
  const hoverPointer = new THREE.Vector2();
  let hoverPointerValid = false;

  const resetPlayerInput = () => {
    playerInput.forward = 0;
    playerInput.right = 0;
    playerInput.sprint = false;
    playerInput.jump = false;
    digHeld = false;
  };
  const updatePlayerModeUi = () => {
    document.body.dataset.playerMode = interaction.mode;
    orbitModeButton.setAttribute("aria-pressed", String(interaction.mode === "orbit"));
    playerModeButton.setAttribute("aria-pressed", String(interaction.mode !== "orbit"));
    if (tabUiHold && interaction.mode === "playing") {
      playerModeStatus.textContent = "Tab held — click palette · release Tab to look";
    } else {
      playerModeStatus.textContent = interaction.mode === "choosingSpawn"
        ? "Click the terrain to choose your starting position"
        : interaction.mode === "playing"
          ? "WASD · Shift · Space · Esc · click digs · Shift+wheel radius"
          : "Orbit camera";
    }
    document.body.dataset.tabUi = tabUiHold ? "true" : "false";
    syncTerraformEditMode();
  };
  const syncTerraformEditMode = () => {
    if (!terraformEditCheckbox) return;
    document.body.dataset.tfEdit = terraformEditCheckbox.checked ? "true" : "false";
  };
  let terraformEditCheckbox: HTMLInputElement | null = null;
  const exitPlayerMode = () => {
    tabUiHold = false;
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    playerPointerLocked = false;
    if (interaction.mode === "playing") {
      orbitReturnTarget.copy(player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, DEFAULT_PLAYER_CONFIG.eyeHeight * 0.65);
      controls.target.copy(orbitReturnTarget);
      camera.position.copy(orbitReturnTarget).add(new THREE.Vector3(8, 6, 8));
      camera.lookAt(orbitReturnTarget);
    }
    interaction.exitToOrbit();
    resetPlayerInput();
    controls.enabled = true;
    controls.update();
    if (terraformEditCheckbox) {
      terraformEditCheckbox.checked = true;
      document.body.dataset.tfEdit = "true";
    }
    updatePlayerModeUi();
  };
  const choosePlayerSpawn = () => {
    interaction.chooseSpawn();
    resetPlayerInput();
    controls.enabled = false;
    updatePlayerModeUi();
  };
  const startPlayerAtPointer = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    playerPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    playerRaycaster.setFromCamera(playerPointer, camera);
    const hit = terrainColliders.raycastSpawn(playerRaycaster.ray);
    if (!hit) {
      playerModeStatus.textContent = "No playable terrain there";
      return;
    }

    camera.getWorldDirection(playerForward);
    playerForward.y = 0;
    if (playerForward.lengthSq() < 1e-8) playerForward.set(0, 0, -1);
    else playerForward.normalize();
    playerYaw = Math.atan2(-playerForward.x, -playerForward.z);
    playerPitch = 0;
    player.spawn(hit.point);
    interaction.startPlaying();
    controls.enabled = false;
    editToggleInput.checked = false;
    document.body.dataset.tfEdit = "false";
    updatePlayerModeUi();
    void renderer.domElement.requestPointerLock();
  };

  orbitModeButton.addEventListener("click", exitPlayerMode);
  playerModeButton.addEventListener("click", choosePlayerSpawn);
  // Orbit-mode digs fire on click-without-drag so OrbitControls rotation stays usable.
  let digPointerDown: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (interaction.mode === "choosingSpawn" && event.button === 0) startPlayerAtPointer(event);
    else if (interaction.mode === "playing" && event.button === 0 && document.pointerLockElement !== renderer.domElement) {
      void renderer.domElement.requestPointerLock();
    } else if (interaction.mode === "playing" && event.button === 0 && state.digEnabled) {
      digHeld = true;
      camera.getWorldDirection(digDirection);
      performDig(new THREE.Ray(camera.position.clone(), digDirection.clone()));
    } else if (interaction.mode === "orbit" && event.button === 0 && state.digEnabled) {
      digPointerDown = { x: event.clientX, y: event.clientY };
    }
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (event.button === 0) digHeld = false;
    if (!digPointerDown || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - digPointerDown.x, event.clientY - digPointerDown.y);
    digPointerDown = null;
    if (moved > 4 || interaction.mode !== "orbit" || !state.digEnabled) return;
    const rect = renderer.domElement.getBoundingClientRect();
    playerPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    playerRaycaster.setFromCamera(playerPointer, camera);
    performDig(playerRaycaster.ray);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    hoverPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverPointerValid = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    hoverPointerValid = false;
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === renderer.domElement) {
      playerPointerLocked = true;
      tabUiHold = false;
      updatePlayerModeUi();
    } else if (interaction.mode === "playing" && playerPointerLocked) {
      playerPointerLocked = false;
      if (tabUiHold) {
        updatePlayerModeUi();
        return;
      }
      exitPlayerMode();
    }
  });
  document.addEventListener("pointerlockerror", () => {
    if (interaction.mode === "playing") playerModeStatus.textContent = "Click viewport to capture mouse";
  });
  document.addEventListener("mousemove", (event) => {
    if (interaction.mode !== "playing" || document.pointerLockElement !== renderer.domElement) return;
    playerYaw -= event.movementX * 0.002;
    playerPitch = THREE.MathUtils.clamp(playerPitch - event.movementY * 0.002, -1.5, 1.5);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && interaction.mode === "choosingSpawn") {
      exitPlayerMode();
      return;
    }
    if (event.code === "Escape" && interaction.mode === "playing" && !playerPointerLocked) {
      exitPlayerMode();
      return;
    }
    if (event.code === "Tab" && interaction.mode === "playing") {
      event.preventDefault();
      if (document.pointerLockElement === renderer.domElement) {
        tabUiHold = true;
        document.exitPointerLock();
      }
      return;
    }
    if (interaction.mode !== "playing") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === "KeyW") playerInput.forward = 1;
    if (event.code === "KeyS") playerInput.forward = -1;
    if (event.code === "KeyA") playerInput.right = -1;
    if (event.code === "KeyD") playerInput.right = 1;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") playerInput.sprint = true;
    if (event.code === "Space") playerInput.jump = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Tab" && interaction.mode === "playing" && tabUiHold) {
      tabUiHold = false;
      updatePlayerModeUi();
      if (document.pointerLockElement !== renderer.domElement) {
        void renderer.domElement.requestPointerLock();
      }
      return;
    }
    if (event.code === "KeyW" && playerInput.forward > 0) playerInput.forward = 0;
    if (event.code === "KeyS" && playerInput.forward < 0) playerInput.forward = 0;
    if (event.code === "KeyA" && playerInput.right < 0) playerInput.right = 0;
    if (event.code === "KeyD" && playerInput.right > 0) playerInput.right = 0;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") playerInput.sprint = false;
    if (event.code === "Space") playerInput.jump = false;
  });
  window.addEventListener("blur", () => {
    resetPlayerInput();
    if (tabUiHold) {
      tabUiHold = false;
      updatePlayerModeUi();
    }
  });
  updatePlayerModeUi();

  const state = {
    thresholdPx: cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    colorByLod: true,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 8,
    frontSideOnly: false,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    textureScale: 1,
    triplanar: true,
    albedo: true,
    normalMap: false,
    normalIntensity: 1,
    textureBlendMode: TEXTURE_BLEND_MODES[1] as TextureBlendMode,
    textureBlendWidth: 6,
    loadedTextureFiles: "none",
    terrainBrightness: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness,
    terrainContrast: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast,
    terrainSaturation: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation,
    terrainWarmth: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth,
    sunAzimuthDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunAzimuthDeg,
    sunElevationDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunElevationDeg,
    sunIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity,
    skyIntensity: DEFAULT_ENVIRONMENT_SETTINGS.skyIntensity,
    groundIntensity: DEFAULT_ENVIRONMENT_SETTINGS.groundIntensity,
    exposure: DEFAULT_ENVIRONMENT_SETTINGS.exposure,
    horizonSoftness: DEFAULT_ENVIRONMENT_SETTINGS.horizonSoftness,
    sunDiskIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunDiskIntensity,
    sunGlowIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunGlowIntensity,
    hazeIntensity: DEFAULT_ENVIRONMENT_SETTINGS.hazeIntensity,
    postProcessEnabled: DEFAULT_POST_PROCESS_SETTINGS.enabled,
    postProcessOpacity: DEFAULT_POST_PROCESS_SETTINGS.opacity,
    postProcessExposure: DEFAULT_POST_PROCESS_SETTINGS.exposure,
    postProcessContrast: DEFAULT_POST_PROCESS_SETTINGS.contrast,
    postProcessSaturation: DEFAULT_POST_PROCESS_SETTINGS.saturation,
    postProcessVignette: DEFAULT_POST_PROCESS_SETTINGS.vignette,
    postProcessDebugMode: DEFAULT_POST_PROCESS_SETTINGS.debugMode,
    bubble: false,
    bubbleRadius: cfg.near_field.radius_chunks * cfg.page.chunk_size,
    tintBubble: true,
    digEnabled: true,
    digRadius: 3,
    brushOp: "remove" as BrushOp,
    brushShape: "sphere" as BrushShape,
    brushMaterial: 0,
    brushHeight: 3,
    brushStrength: 1,
    brushFalloff: 0,
    brushFlowMs: DIG_HOLD_INTERVAL_MS,
    grassEnabled: DEFAULT_GRASS_SETTINGS.enabled,
    grassDistance: DEFAULT_GRASS_SETTINGS.distance,
    grassBladeSpacing: DEFAULT_GRASS_SETTINGS.bladeSpacing,
    grassBladeHeight: DEFAULT_GRASS_SETTINGS.bladeHeight,
    grassBladeHeightVariation: DEFAULT_GRASS_SETTINGS.bladeHeightVariation,
    grassBladeWidth: DEFAULT_GRASS_SETTINGS.bladeWidth,
    grassWindStrength: DEFAULT_GRASS_SETTINGS.windStrength,
    grassWindSpeed: DEFAULT_GRASS_SETTINGS.windSpeed,
    grassSlopeMinY: DEFAULT_GRASS_SETTINGS.slopeMinY,
    grassMinHeight: DEFAULT_GRASS_SETTINGS.minHeight,
    grassMaxHeight: DEFAULT_GRASS_SETTINGS.maxHeight,
    grassMaxBlades: DEFAULT_GRASS_SETTINGS.maxBlades,
    grassSeed: DEFAULT_GRASS_SETTINGS.seed,
    grassBladeCount: 0,
  };
  if (stagedImport) Object.assign(state, stagedImport.manifest.state);
  const currentTerrainColorAdjustments = (): TerrainColorAdjustments => ({
    brightness: state.terrainBrightness,
    contrast: state.terrainContrast,
    saturation: state.terrainSaturation,
    warmth: state.terrainWarmth,
  });
  const currentEnvironmentSettings = (): EnvironmentSettings => ({
    sunAzimuthDeg: state.sunAzimuthDeg,
    sunElevationDeg: state.sunElevationDeg,
    sunIntensity: state.sunIntensity,
    skyIntensity: state.skyIntensity,
    groundIntensity: state.groundIntensity,
    exposure: state.exposure,
    horizonSoftness: state.horizonSoftness,
    sunDiskIntensity: state.sunDiskIntensity,
    sunGlowIntensity: state.sunGlowIntensity,
    hazeIntensity: state.hazeIntensity,
  });
  const currentPostProcessSettings = (): PostProcessSettings => ({
    enabled: state.postProcessEnabled,
    opacity: state.postProcessOpacity,
    exposure: state.postProcessExposure,
    contrast: state.postProcessContrast,
    saturation: state.postProcessSaturation,
    vignette: state.postProcessVignette,
    debugMode: state.postProcessDebugMode,
  });
  const postProcess = new PostProcessPipeline(renderer, currentPostProcessSettings());
  postProcess.setSize(window.innerWidth, window.innerHeight);
  const skyEnvironment = new SkyEnvironment({
    scene,
    renderer,
    radius: Math.max(1600, worldCells * 5),
    settings: currentEnvironmentSettings(),
    colors: DEFAULT_ENVIRONMENT_COLORS,
  });
  const applyLightingToMaterial = (
    mat: THREE.ShaderMaterial,
    lighting: EnvironmentLighting = skyEnvironment.lighting(),
  ) => {
    mat.uniforms.uLight.value.copy(lighting.sunDirection);
    mat.uniforms.uSunColor.value.copy(lighting.sunColor);
    mat.uniforms.uSkyLight.value.copy(lighting.skyLight);
    mat.uniforms.uGroundLight.value.copy(lighting.groundLight);
  };

  const textureSlots: TextureSlot[] = Array.from({ length: MAX_TERRAIN_TEXTURES }, () => ({
    texture: null,
    normalTexture: null,
    normalPreviewUrl: null,
    normalBytes: null,
    normalMimeType: null,
    normalExtension: null,
    name: "empty",
    previewUrl: null,
    selectedId: "",
    customBytes: null,
    customMimeType: null,
    customExtension: null,
    scale: 1 / 64,
    heightMin: 0,
    heightMax: 0,
  }));
  for (let i = 0; i < textureSlots.length; i++) {
    const preset = DEFAULT_TERRAIN_TEXTURE_PRESETS[i];
    const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id);
    textureSlots[i].selectedId = preset.id;
    textureSlots[i].scale = preset.scale;
    textureSlots[i].heightMin = preset.heightMin;
    textureSlots[i].heightMax = preset.heightMax;
    textureSlots[i].name = builtin?.label ?? preset.id;
    const imported = stagedImport?.manifest.textures[i];
    if (imported) {
      textureSlots[i].name = imported.name;
      textureSlots[i].selectedId = imported.selectedId;
      textureSlots[i].scale = imported.scale;
      textureSlots[i].heightMin = imported.heightMin;
      textureSlots[i].heightMax = imported.heightMax;
      textureSlots[i].customMimeType = imported.mimeType ?? null;
      textureSlots[i].customExtension = imported.customPath?.match(/(\.[a-z0-9]+)$/i)?.[1] ?? null;
    }
  }
  let activeTerrainSlots: TextureSlot[] = [];
  // assigned when the terraform menu is built; refreshes the material swatches after textures change
  let refreshTerraformSwatches: () => void = () => {};
  let syncTerraformMenu: () => void = () => {};
  const rebuildActiveTerrainSlots = () => {
    activeTerrainSlots = textureSlots.filter((slot) => slot.texture !== null);
  };
  const applyTerrainTextures = () => {
    rebuildActiveTerrainSlots();
    const enabled = state.albedo && activeTerrainSlots.length > 0;
    const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
    const normalUniforms = ["uTerrainNormal0", "uTerrainNormal1", "uTerrainNormal2", "uTerrainNormal3"];
    const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
    const apply = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.uUseTexture.value = enabled;
      mat.uniforms.uUseTriplanar.value = state.triplanar;
      mat.uniforms.uUseNormalMap.value = state.normalMap;
      mat.uniforms.uNormalIntensity.value = state.normalIntensity;
      mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
      mat.uniforms.uTextureScales.value.set(
        (activeTerrainSlots[0]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[1]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[2]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[3]?.scale ?? 1 / 64) * state.textureScale,
      );
      mat.uniforms.uNormalMapMask.value.set(
        activeTerrainSlots[0]?.normalTexture ? 1 : 0,
        activeTerrainSlots[1]?.normalTexture ? 1 : 0,
        activeTerrainSlots[2]?.normalTexture ? 1 : 0,
        activeTerrainSlots[3]?.normalTexture ? 1 : 0,
      );
      mat.uniforms.uTextureBlendBands.value = state.textureBlendMode === "blend bands";
      mat.uniforms.uTextureBlendWidth.value = state.textureBlendWidth;
      for (let i = 0; i < textureUniforms.length; i++) {
        const slot = activeTerrainSlots[i];
        mat.uniforms[textureUniforms[i]].value = slot?.texture ?? null;
        mat.uniforms[normalUniforms[i]].value = slot?.normalTexture ?? null;
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
    refreshTerraformSwatches();
  };

  // One view per node; visibility/fade drive what's drawn.
  const views = new Map<string, NodeView>();
  for (const node of allNodes) {
    const mat = createTerrainMaterial(LOD_COLORS[Math.min(node.level, LOD_COLORS.length - 1)]);
    applyTerrainColorAdjustments(mat, currentTerrainColorAdjustments());
    applyLightingToMaterial(mat);
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

  // brush preview reticle: translucent volume at the aim point, sized to the brush radius,
  // shaped to the active brush and tinted by op (remove = red, add = green). Geometries are
  // unit-sized so a uniform scale by the radius matches the brush SDFs exactly.
  const brushPreviewGeometries: Record<BrushShape, THREE.BufferGeometry> = {
    sphere: new THREE.SphereGeometry(1, 24, 16),
    cube: new THREE.BoxGeometry(2, 2, 2),
    cylinder: new THREE.CylinderGeometry(1, 1, 2, 28),
  };
  const digPreview = new THREE.Mesh(
    brushPreviewGeometries.sphere,
    new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  digPreview.visible = false;
  scene.add(digPreview);
  const seamGroup = new THREE.Group();
  scene.add(seamGroup);
  const crossLodBorderGroup = new THREE.Group();
  scene.add(crossLodBorderGroup);

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
        mat.uniforms.uUseTriplanar.value = state.triplanar;
        mat.uniforms.uNormalDivergence.value = state.normalDivergence;
        mat.uniforms.uDivergenceGain.value = state.divergenceGain;
        applyTerrainColorAdjustments(mat, currentTerrainColorAdjustments());
        mat.side = state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide;
        rebuildActiveTerrainSlots();
        const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
        const normalUniforms = ["uTerrainNormal0", "uTerrainNormal1", "uTerrainNormal2", "uTerrainNormal3"];
        const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
        mat.uniforms.uUseTexture.value = state.albedo && activeTerrainSlots.length > 0;
        mat.uniforms.uUseNormalMap.value = state.normalMap;
        mat.uniforms.uNormalIntensity.value = state.normalIntensity;
        mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
        mat.uniforms.uTextureScales.value.set(
          (activeTerrainSlots[0]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[1]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[2]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[3]?.scale ?? 1 / 64) * state.textureScale,
        );
        mat.uniforms.uNormalMapMask.value.set(
          activeTerrainSlots[0]?.normalTexture ? 1 : 0,
          activeTerrainSlots[1]?.normalTexture ? 1 : 0,
          activeTerrainSlots[2]?.normalTexture ? 1 : 0,
          activeTerrainSlots[3]?.normalTexture ? 1 : 0,
        );
        mat.uniforms.uTextureBlendBands.value = state.textureBlendMode === "blend bands";
        mat.uniforms.uTextureBlendWidth.value = state.textureBlendWidth;
        for (let ti = 0; ti < textureUniforms.length; ti++) {
          const slot = activeTerrainSlots[ti];
          mat.uniforms[textureUniforms[ti]].value = slot?.texture ?? null;
          mat.uniforms[normalUniforms[ti]].value = slot?.normalTexture ?? null;
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

  const makeGrassSettings = (): GrassSettings => ({
    enabled: state.grassEnabled,
    distance: state.grassDistance,
    bladeSpacing: state.grassBladeSpacing,
    bladeHeight: state.grassBladeHeight,
    bladeHeightVariation: state.grassBladeHeightVariation,
    bladeWidth: state.grassBladeWidth,
    windStrength: state.grassWindStrength,
    windSpeed: state.grassWindSpeed,
    slopeMinY: state.grassSlopeMinY,
    minHeight: state.grassMinHeight,
    maxHeight: state.grassMaxHeight,
    maxBlades: state.grassMaxBlades,
    seed: state.grassSeed,
  });
  const currentGrassLighting = (): GrassLighting => {
    const lighting = skyEnvironment.lighting();
    return {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
  };
  let grass: GrassSystem | null = null;
  let selState: SelectionState = { split: new Set() };
  const crossfadeStep = 1 / cfg.selection.crossfade_frames;
  const forEachTerrainMaterial = (fn: (mat: THREE.ShaderMaterial) => void) => {
    for (const v of views.values()) fn(v.mat);
    for (const { mats } of chunkGroups.values()) for (const m of mats) fn(m);
  };
  const applyColorAdjustmentsToTerrain = () => {
    const adjustments = currentTerrainColorAdjustments();
    forEachTerrainMaterial((mat) => applyTerrainColorAdjustments(mat, adjustments));
  };
  const updateLighting = () => {
    skyEnvironment.updateSettings(currentEnvironmentSettings());
    const lighting = skyEnvironment.lighting();
    forEachTerrainMaterial((mat) => applyLightingToMaterial(mat, lighting));
    grass?.updateLighting({
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    });
  };
  const grassSystem = new GrassSystem({
    scene,
    nodes: allNodes.filter((node) => node.level === 0),
    worldCells,
    settings: makeGrassSettings(),
    lighting: currentGrassLighting(),
  });
  grass = grassSystem;
  state.grassBladeCount = grassSystem.getBladeCount();

  const rebuildDebugOverlays = (rendered: ClodPageNode[], xLodAdjacencies: CrossLodAdjacency[]) => {
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
    if (state.showSeamPoints) {
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
    }

    crossLodBorderGroup.clear();
    if (!state.showCrossLodBorders) return;
    const borderPts: number[] = [];
    for (const adjacency of xLodAdjacencies) appendCrossLodBorderSegments(borderPts, adjacency);
    if (borderPts.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(borderPts), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        depthTest: false,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geom, mat);
      lines.renderOrder = 21;
      crossLodBorderGroup.add(lines);
    }
  };

  let lastCutKey = "";
  let lastDebugKey = "";
  let lastForced = 0;
  let lastNearFieldForced = 0;
  let lastCrossLodAdjacencyCount = 0;
  let lastRenderedCount = 0;
  let lastLevelSummary = "";
  let lastTriCount = 0;
  let averageFps = 0;
  let lastDigSummary = "";
  let lastArchiveSummary = "";

  const updateInfo = () => {
    const playerLine = interaction.mode === "playing"
      ? `player: grounded=${player.grounded}  physics p95=${player.physicsP95Ms().toFixed(2)} ms  collider pages=${player.lastPagesTested}`
      : `view: ${interaction.mode}`;
    info.textContent =
      `CLOD Pages PoC — Phase 2 runtime — ${WORLD}x${WORLD} pages\n` +
      `cut: ${lastRenderedCount} nodes  (${lastLevelSummary})\n` +
      `tris rendered: ${lastTriCount.toLocaleString()}   2:1 forced splits: ${lastForced}   ` +
      `bubble forced splits: ${lastNearFieldForced}   xLOD borders: ${lastCrossLodAdjacencyCount}\n` +
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${averageFps.toFixed(1)}   ` +
      `${state.forceMaxLevel === "auto" ? "" : `forced<=${state.forceMaxLevel}   `}${state.freeze ? "[FROZEN]" : ""}\n` +
      `grass: ${state.grassEnabled ? "enabled" : "disabled"} ${state.grassBladeCount.toLocaleString()} blades\n` +
      `brush: ${state.digEnabled ? "on" : "off"}  ${state.brushOp === "add" ? "raise" : "dig"} ${state.brushShape} r=${state.digRadius}  edits=${digEditCount()}` +
      `${lastDigSummary ? `  last: ${lastDigSummary}` : ""}\n` +
      `${lastArchiveSummary ? `${lastArchiveSummary}\n` : ""}` +
      playerLine;
  };

  const updateSelection = () => {
    const selectionCenter = interaction.mode === "playing" ? player.position : controls.target;
    const params: SelectionParams = {
      thresholdPx: state.thresholdPx,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      enforce21: state.enforce21,
      nearField: {
        enabled: state.bubble,
        centerX: selectionCenter.x,
        centerZ: selectionCenter.z,
        radius: state.bubbleRadius,
        boundaryPadding: cfg.page.chunks_per_page * cfg.page.chunk_size,
      },
      viewportH: renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(camera.fov),
      camPos: [camera.position.x, camera.position.y, camera.position.z],
      forcedMaxLevel: state.forceMaxLevel === "auto" ? null : Number(state.forceMaxLevel),
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
    const xLodAdjacencies = crossLodAdjacencies(rendered);
    lastCrossLodAdjacencyCount = xLodAdjacencies.length;
    lastRenderedCount = rendered.length;
    lastLevelSummary = [...perLevel.keys()].sort().map((l) => `L${l}:${perLevel.get(l)}`).join("  ");
    lastTriCount = tris;

    const cutKey = [...cutIds].sort().join("|");
    if (cutKey !== lastCutKey) {
      lastCutKey = cutKey;
      updateInfo();
    }
    const debugKey = `${cutKey}|bounds:${state.showBounds}|seams:${state.showSeamPoints}|xlod:${state.showCrossLodBorders}`;
    if (debugKey !== lastDebugKey) {
      lastDebugKey = debugKey;
      rebuildDebugOverlays(rendered, xLodAdjacencies);
    }
  };

  // Swap a rebuilt node's mesh into its view (and, for LOD0, its collider + raw-chunk
  // bubble). Returns the collider-update cost in ms (0 for parents). Shared by the
  // synchronous LOD0 phase and the deferred ancestor drain.
  const applyNodeMesh = (node: ClodPageNode): number => {
    const v = views.get(node.id);
    if (v) {
      v.mesh.geometry.dispose();
      v.mesh.geometry = toGeometry(node.mesh);
      v.sourceNormals = node.mesh.normals;
      v.recomputedNormals = computeGeometryNormals(node.mesh);
      if (state.recomputedNormals) {
        v.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(v.recomputedNormals, 3));
      }
    }
    if (node.level !== 0) return 0;
    const tc = performance.now();
    const g = toGeometry(node.mesh);
    terrainColliders.updatePage(node.id, g);
    g.dispose();
    // drop the cached raw-chunk bubble meshes; they regenerate lazily when owned
    const chunkEntry = chunkGroups.get(node.id);
    if (chunkEntry) {
      scene.remove(chunkEntry.group);
      for (const child of chunkEntry.group.children) (child as THREE.Mesh).geometry.dispose();
      for (const m of chunkEntry.mats) m.dispose();
      chunkGroups.delete(node.id);
    }
    return performance.now() - tc;
  };

  // Deferred ancestor re-simplification. Each dig applies its LOD0 pages immediately
  // (that's the surface you're looking at), then queues the LOD1+ ancestor chain here.
  // The animate loop drains it under a per-frame time budget so the tab keeps rendering
  // instead of freezing for the full edit. Processed strictly lowest-level-first, so
  // every parent re-merges from already-rebuilt children — same invariant as a full build.
  const ancestorIndex: NodeIndex = buildNodeIndex(result);
  const topLevel = Math.max(...result.nodesByLevel.keys());
  const pendingByLevel = new Map<number, Set<string>>();
  let pendingParentNodes = 0;
  let pendingParentMs = 0;
  const DRAIN_BUDGET_MS = 8;

  const enqueueParent = (level: number, nx: number, nz: number) => {
    if (level > topLevel) return;
    let s = pendingByLevel.get(level);
    if (!s) { s = new Set(); pendingByLevel.set(level, s); }
    s.add(`${nx},${nz}`);
  };

  const drainAncestors = () => {
    let lowest = -1;
    for (let L = 1; L <= topLevel; L++) {
      if ((pendingByLevel.get(L)?.size ?? 0) > 0) { lowest = L; break; }
    }
    if (lowest === -1) return;
    const start = performance.now();
    let changed = false;
    do {
      let level = -1;
      for (let L = 1; L <= topLevel; L++) {
        if ((pendingByLevel.get(L)?.size ?? 0) > 0) { level = L; break; }
      }
      if (level === -1) break;
      const set = pendingByLevel.get(level)!;
      const key = set.values().next().value as string;
      set.delete(key);
      const t = performance.now();
      const node = resimplifyParent(ancestorIndex, level, key, cfg);
      pendingParentMs += performance.now() - t;
      if (node) {
        applyNodeMesh(node);
        pendingParentNodes++;
        changed = true;
        const [nx, nz] = key.split(",").map(Number);
        enqueueParent(level + 1, nx >> 1, nz >> 1);
      }
    } while (performance.now() - start < DRAIN_BUDGET_MS);

    const draining = [...pendingByLevel.values()].some((s) => s.size > 0);
    if (changed) {
      lastCutKey = "";
      lastDebugKey = "";
      if (!draining) {
        // ancestors settled: fold their cost into the dig summary and refresh selection
        lastDigSummary =
          `${lastDigSummary} + ancestors ${pendingParentNodes}n ${pendingParentMs.toFixed(0)}ms`;
        updateSelection();
        updateInfo();
      }
    }
  };

  const flushAncestors = () => {
    while ([...pendingByLevel.values()].some((pending) => pending.size > 0)) drainAncestors();
  };

  // Carve a sphere where the ray hits, then pay the CLOD edit cost. The LOD0 pages
  // (the surface you're looking at) plus their colliders rebuild synchronously so the
  // hole appears now; the LOD1+ ancestor chain is queued for the per-frame drain above.
  // The timing breakdown lands in the overlay + console — that's the experiment.
  const performDig = (ray: THREE.Ray) => {
    const hit = terrainColliders.raycastSurface(ray);
    if (!hit) return;
    const radius = state.digRadius;
    addDigEdit({
      x: hit.point.x, y: hit.point.y, z: hit.point.z, r: radius,
      shape: state.brushShape, op: state.brushOp,
      material: state.brushOp === "add" ? state.brushMaterial : undefined,
      height: state.brushHeight, strength: state.brushStrength, falloff: state.brushFalloff,
    });
    const t0 = performance.now();
    const margin = radius + DIG_INFLUENCE_MARGIN;
    const lod0 = rebuildDirtyLod0Pages(result, {
      minX: hit.point.x - margin,
      maxX: hit.point.x + margin,
      minZ: hit.point.z - margin,
      maxZ: hit.point.z + margin,
    }, cfg, ancestorIndex);

    let colliderMs = 0;
    for (const node of lod0.changed) colliderMs += applyNodeMesh(node);
    // seed the deferred ancestor chain from the dug LOD0 pages
    pendingParentNodes = 0;
    pendingParentMs = 0;
    for (const [nx, nz] of lod0.dirtyCoords) enqueueParent(1, nx >> 1, nz >> 1);

    const totalMs = performance.now() - t0;
    lastDigSummary =
      `${totalMs.toFixed(0)}ms now (LOD0 ${lod0.lod0Pages}p ${lod0.lod0Ms.toFixed(0)}ms · ` +
      `${lod0.chunksRemeshed}/${lod0.chunksTotal} chunks · collider ${colliderMs.toFixed(0)}ms)`;
    console.log(
      `[${state.brushOp} ${state.brushShape} r=${radius}] at (${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}) — ${lastDigSummary} — ancestors deferred`,
    );
    lastDigAt = performance.now();
    lastCutKey = "";
    lastDebugKey = "";
    updateSelection();
    updateInfo();
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
  gui.add(state, "forceMaxLevel", ["auto", "0", "1", "2", "3"]).name("force max level").onChange(() => {
    selState = { split: new Set() };
    updateSelection();
  });
  gui.add(state, "enforce21").name("2:1 constraint").onChange(updateSelection);
  gui.add(state, "freeze").name("freeze selection");
  gui.add(state, "showBounds").name("page boundaries").onChange(updateSelection);
  gui.add(state, "showSeamPoints").name("same-LOD seam points").onChange(updateSelection);
  gui.add(state, "showCrossLodBorders").name("cross-LOD borders").onChange(updateSelection);
  gui.add(state, "wireframe").name("wireframe").onChange((on: boolean) => {
    for (const v of views.values()) v.mat.wireframe = on;
  });
  gui.add(state, "normalColor").name("normal colours").onChange((on: boolean) => {
    forEachTerrainMaterial((m) => {
      m.uniforms.uNormalColor.value = on;
    });
  });
  gui.add(state, "normalDivergence").name("normal divergence").onChange((on: boolean) => {
    forEachTerrainMaterial((m) => {
      m.uniforms.uNormalDivergence.value = on;
    });
  });
  gui.add(state, "divergenceGain", 1, 32, 0.5).name("divergence gain").onChange((gain: number) => {
    forEachTerrainMaterial((m) => {
      m.uniforms.uDivergenceGain.value = gain;
    });
  });
  gui.add(state, "frontSideOnly").name("front side only").onChange((on: boolean) => {
    forEachTerrainMaterial((m) => {
      m.side = on ? THREE.FrontSide : THREE.DoubleSide;
      m.needsUpdate = true;
    });
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
  const environmentFolder = gui.addFolder("sky + environment");
  const environmentControllers = [
    environmentFolder.add(state, "sunAzimuthDeg", 0, 360, 1).name("sun azimuth").onChange(updateLighting),
    environmentFolder.add(state, "sunElevationDeg", 5, 85, 1).name("sun elevation").onChange(updateLighting),
    environmentFolder.add(state, "sunIntensity", 0, 2.5, 0.05).name("sun intensity").onChange(updateLighting),
    environmentFolder.add(state, "skyIntensity", 0, 2, 0.05).name("sky fill").onChange(updateLighting),
    environmentFolder.add(state, "groundIntensity", 0, 2, 0.05).name("ground fill").onChange(updateLighting),
    environmentFolder.add(state, "exposure", 0.4, 2, 0.05).name("exposure").onChange(updateLighting),
    environmentFolder.add(state, "horizonSoftness", 0.2, 2.5, 0.01).name("horizon softness").onChange(updateLighting),
    environmentFolder.add(state, "sunDiskIntensity", 0, 4, 0.05).name("sun disk").onChange(updateLighting),
    environmentFolder.add(state, "sunGlowIntensity", 0, 4, 0.05).name("sun glow").onChange(updateLighting),
    environmentFolder.add(state, "hazeIntensity", 0, 1.5, 0.01).name("haze").onChange(updateLighting),
  ];
  const environmentActions = {
    reset: () => {
      Object.assign(state, DEFAULT_ENVIRONMENT_SETTINGS);
      updateLighting();
      for (const controller of environmentControllers) controller.updateDisplay();
    },
  };
  environmentFolder.add(environmentActions, "reset").name("reset");
  // TODO: Add editable sky color controls after the environment module is stable.
  const colorFolder = gui.addFolder("terrain color");
  const colorControllers = [
    colorFolder.add(state, "terrainBrightness", 0.2, 2.5, 0.01).name("brightness").onChange(applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainContrast", 0.2, 2.5, 0.01).name("contrast").onChange(applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainSaturation", 0.0, 2.5, 0.01).name("saturation").onChange(applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainWarmth", -1.0, 1.0, 0.01).name("warmth").onChange(applyColorAdjustmentsToTerrain),
  ];
  const colorActions = {
    reset: () => {
      state.terrainBrightness = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness;
      state.terrainContrast = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast;
      state.terrainSaturation = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation;
      state.terrainWarmth = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth;
      applyColorAdjustmentsToTerrain();
      for (const controller of colorControllers) controller.updateDisplay();
    },
  };
  colorFolder.add(colorActions, "reset").name("reset");
  const postFolder = gui.addFolder("postprocess");
  const postControllers = [
    postFolder.add(state, "postProcessEnabled").name("enabled"),
    postFolder.add(state, "postProcessDebugMode", ["output", "copy", "off"]).name("mode"),
    postFolder.add(state, "postProcessOpacity", 0, 1, 0.01).name("copy opacity"),
    postFolder.add(state, "postProcessExposure", 0.25, 2.5, 0.01).name("pass exposure"),
    postFolder.add(state, "postProcessContrast", 0.25, 2.5, 0.01).name("contrast"),
    postFolder.add(state, "postProcessSaturation", 0, 2.5, 0.01).name("saturation"),
    postFolder.add(state, "postProcessVignette", 0, 1.5, 0.01).name("vignette"),
  ];
  const postActions = {
    reset: () => {
      state.postProcessEnabled = DEFAULT_POST_PROCESS_SETTINGS.enabled;
      state.postProcessOpacity = DEFAULT_POST_PROCESS_SETTINGS.opacity;
      state.postProcessExposure = DEFAULT_POST_PROCESS_SETTINGS.exposure;
      state.postProcessContrast = DEFAULT_POST_PROCESS_SETTINGS.contrast;
      state.postProcessSaturation = DEFAULT_POST_PROCESS_SETTINGS.saturation;
      state.postProcessVignette = DEFAULT_POST_PROCESS_SETTINGS.vignette;
      state.postProcessDebugMode = DEFAULT_POST_PROCESS_SETTINGS.debugMode;
      postProcess.updateSettings(currentPostProcessSettings());
      for (const controller of postControllers) controller.updateDisplay();
    },
  };
  postFolder.add(postActions, "reset").name("reset");
  let grassBladeCountController: { updateDisplay: () => unknown } | null = null;
  const grassActions = {
    rebuild: () => {
      grassSystem.updateSettings(makeGrassSettings());
      grassSystem.rebuild();
      state.grassBladeCount = grassSystem.getBladeCount();
      grassBladeCountController?.updateDisplay();
      updateInfo();
    },
  };
  const updateGrassUniforms = () => grassSystem.updateSettings(makeGrassSettings());
  const grassFolder = gui.addFolder("grass shader");
  grassFolder.add(state, "grassEnabled").name("enabled").onChange((enabled: boolean) => {
    grassSystem.setEnabled(enabled);
    updateInfo();
  });
  grassFolder.add(state, "grassDistance", 16, 512, 1).name("distance").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassBladeSpacing", 0.4, 6, 0.1).name("blade spacing").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeHeight", 0.2, 4, 0.05).name("blade height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeHeightVariation", 0, 1, 0.05).name("height variation").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeWidth", 0.01, 0.4, 0.01).name("blade width").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassWindStrength", 0, 1.5, 0.01).name("wind strength").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassWindSpeed", 0, 4, 0.05).name("wind speed").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassSlopeMinY", 0, 1, 0.01).name("slope min Y").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMinHeight", 0, 128, 1).name("min height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMaxHeight", 0, 128, 1).name("max height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMaxBlades", 0, 100000, 1000).name("max blades").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassSeed", 0, 100000, 1).name("seed").onFinishChange(grassActions.rebuild);
  grassBladeCountController = grassFolder.add(state, "grassBladeCount").name("blade count").disable();
  grassFolder.add(grassActions, "rebuild").name("rebuild");
  const textureInput = document.createElement("input");
  textureInput.type = "file";
  textureInput.accept = "image/*";
  textureInput.multiple = true;
  textureInput.style.display = "none";
  document.body.appendChild(textureInput);
  const normalInput = document.createElement("input");
  normalInput.type = "file";
  normalInput.accept = "image/*";
  normalInput.style.display = "none";
  document.body.appendChild(normalInput);
  let pendingNormalLoad: number | null = null;
  normalInput.addEventListener("change", async () => {
    const file = normalInput.files?.[0];
    normalInput.value = "";
    if (file == null || pendingNormalLoad == null) return;
    const result = await loadNormalMap(file);
    if (result) setSlotNormal(pendingNormalLoad, result.texture, result.previewUrl, result.bytes, result.mimeType, result.extension);
    pendingNormalLoad = null;
    refreshTextureState();
  });
  let pendingTextureLoad: number | "all" | null = null;
  const slotCards: HTMLElement[] = [];
  let loadedTextureController: { updateDisplay: () => unknown } | null = null;
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
    const normalBtn = card.querySelector<HTMLElement>(".texture-normal-load");
    if (normalBtn) normalBtn.textContent = slot.normalTexture ? "Normal map ✓" : "+ Normal map";
    card.title = `${TERRAIN_TEXTURE_BANDS[index]} height texture`;
  };
  const updateTextureSlotPreviews = () => {
    for (let i = 0; i < textureSlots.length; i++) updateTextureSlotPreview(i);
  };
  const textureOptionHtml = [
    `<option value="">None</option>`,
    ...BUILTIN_TERRAIN_TEXTURES.map((texture) => `<option value="${texture.id}">${texture.label}</option>`),
    `<option value="custom">Custom file...</option>`,
  ].join("");
  const refreshTextureState = () => {
    updateLoadedTextureDisplay();
    updateTextureSlotPreviews();
    syncTextureModalControls();
    applyTerrainTextures();
  };
  const setTextureSlot = (
    index: number,
    texture: THREE.Texture,
    name: string,
    previewUrl: string,
    customBytes: Uint8Array,
    customMimeType: string,
    customExtension: string,
  ) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = {
      ...old,
      texture,
      name,
      previewUrl,
      selectedId: "custom",
      customBytes: customBytes.slice(),
      customMimeType,
      customExtension,
    };
  };
  const setBuiltinTextureSlot = (index: number, texture: THREE.Texture, name: string, previewUrl: string, selectedId: string) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = {
      ...old,
      texture,
      name,
      previewUrl,
      selectedId,
      customBytes: null,
      customMimeType: null,
      customExtension: null,
    };
  };
  const clearTextureSlot = (index: number) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    old.normalTexture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    textureSlots[index] = {
      ...old,
      texture: null,
      normalTexture: null,
      normalPreviewUrl: null,
      name: "empty",
      previewUrl: null,
      selectedId: "",
      customBytes: null,
      customMimeType: null,
      customExtension: null,
    };
  };
  const setSlotNormal = (
    index: number,
    texture: THREE.Texture,
    previewUrl: string,
    bytes: Uint8Array,
    mimeType: string,
    extension: string,
  ) => {
    const old = textureSlots[index];
    old.normalTexture?.dispose();
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    textureSlots[index] = {
      ...old,
      normalTexture: texture,
      normalPreviewUrl: previewUrl,
      normalBytes: bytes.slice(),
      normalMimeType: mimeType,
      normalExtension: extension,
    };
  };
  const clearSlotNormal = (index: number) => {
    const old = textureSlots[index];
    old.normalTexture?.dispose();
    if (old.normalPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.normalPreviewUrl);
    textureSlots[index] = {
      ...old,
      normalTexture: null,
      normalPreviewUrl: null,
      normalBytes: null,
      normalMimeType: null,
      normalExtension: null,
    };
  };
  const clearAllTextures = () => {
    for (let i = 0; i < textureSlots.length; i++) clearTextureSlot(i);
    refreshTextureState();
  };
  const configureTerrainTexture = (texture: THREE.Texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  };
  // Normal maps are linear data, not colour — decoding them as sRGB skews the vectors.
  const configureNormalTexture = (texture: THREE.Texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  };
  const loadNormalMap = async (file: File): Promise<{
    texture: THREE.Texture;
    previewUrl: string;
    bytes: Uint8Array;
    mimeType: string;
    extension: string;
  } | null> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          configureNormalTexture(texture);
          const mimeType = file.type || "application/octet-stream";
          resolve({ texture, previewUrl: url, bytes, mimeType, extension: extensionForTexture(file.name, mimeType) });
        },
        undefined,
        () => {
          URL.revokeObjectURL(url);
          resolve(null);
        },
      );
    });
  };
  const textureActions = {
    loadTexture: () => {
      syncTextureModalControls();
      updateTextureSlotPreviews();
      textureModal.hidden = false;
    },
    clearTexture: clearAllTextures,
  };
  const loadTerrainTextureUrl = (url: string): Promise<THREE.Texture | null> =>
    new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (texture) => {
          configureTerrainTexture(texture);
          resolve(texture);
        },
        undefined,
        () => resolve(null),
      );
    });
  const extensionForTexture = (name: string, mimeType: string): string => {
    const fromName = name.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (fromName && fromName.length <= 8) return fromName;
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    return ".jpg";
  };
  const loadTerrainTexture = async (file: File): Promise<{
    texture: THREE.Texture;
    previewUrl: string;
    bytes: Uint8Array;
    mimeType: string;
    extension: string;
  } | null> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          configureTerrainTexture(texture);
          const mimeType = file.type || "application/octet-stream";
          resolve({
            texture,
            previewUrl: url,
            bytes,
            mimeType,
            extension: extensionForTexture(file.name, mimeType),
          });
        },
        undefined,
        () => {
          URL.revokeObjectURL(url);
          resolve(null);
        },
      );
    });
  };
  textureInput.addEventListener("change", async () => {
    const files = Array.from(textureInput.files ?? []);
    if (files.length === 0) return;
    if (pendingTextureLoad === "all") {
      const loaded = await Promise.all(files.slice(0, MAX_TERRAIN_TEXTURES).map(loadTerrainTexture));
      loaded.forEach((result, index) => {
        if (result) setTextureSlot(
          index,
          result.texture,
          files[index].name,
          result.previewUrl,
          result.bytes,
          result.mimeType,
          result.extension,
        );
      });
    } else if (typeof pendingTextureLoad === "number") {
      const result = await loadTerrainTexture(files[0]);
      if (result) setTextureSlot(
        pendingTextureLoad,
        result.texture,
        files[0].name,
        result.previewUrl,
        result.bytes,
        result.mimeType,
        result.extension,
      );
    }
    pendingTextureLoad = null;
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
        <div class="texture-actions">
          <button type="button" data-texture-load-all>Load custom set</button>
          <button type="button" data-texture-clear>Clear</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(textureModal);
  const texturePanel = textureModal.querySelector<HTMLElement>(".texture-panel")!;
  const texturePanelHeader = texturePanel.querySelector<HTMLElement>("header")!;
  let texturePanelDrag:
    | {
        pointerId: number;
        offsetX: number;
        offsetY: number;
      }
    | null = null;
  const clampTexturePanelPosition = (left: number, top: number) => {
    const rect = texturePanel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    texturePanel.style.left = `${THREE.MathUtils.clamp(left, 8, maxLeft)}px`;
    texturePanel.style.top = `${THREE.MathUtils.clamp(top, 8, maxTop)}px`;
    texturePanel.style.transform = "none";
  };
  texturePanelHeader.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = texturePanel.getBoundingClientRect();
    texturePanelDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    texturePanelHeader.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  texturePanelHeader.addEventListener("pointermove", (event) => {
    if (!texturePanelDrag || texturePanelDrag.pointerId !== event.pointerId) return;
    clampTexturePanelPosition(event.clientX - texturePanelDrag.offsetX, event.clientY - texturePanelDrag.offsetY);
  });
  const stopTexturePanelDrag = (event: PointerEvent) => {
    if (!texturePanelDrag || texturePanelDrag.pointerId !== event.pointerId) return;
    texturePanelDrag = null;
    if (texturePanelHeader.hasPointerCapture(event.pointerId)) {
      texturePanelHeader.releasePointerCapture(event.pointerId);
    }
  };
  texturePanelHeader.addEventListener("pointerup", stopTexturePanelDrag);
  texturePanelHeader.addEventListener("pointercancel", stopTexturePanelDrag);
  const slotGrid = textureModal.querySelector<HTMLElement>(".texture-slot-grid")!;
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const card = document.createElement("article");
    card.className = "texture-slot";
    card.innerHTML = `
      <button class="texture-preview" type="button">${TERRAIN_TEXTURE_BANDS[i]}</button>
      <span class="texture-slot-name">empty</span>
      <label class="texture-slot-select"><span>Use Demo Texture</span><select data-slot-texture="${i}">${textureOptionHtml}</select></label>
      <div class="texture-slot-params">
        <label class="texture-slot-param"><span>Scale</span><input data-slot-scale="${i}" type="number" min="${1 / 512}" max="${1 / 8}" step="${1 / 512}" value="${textureSlots[i].scale}" /></label>
        <label class="texture-slot-param"><span>Low</span><input data-slot-low="${i}" type="number" min="0" max="128" step="1" value="${textureSlots[i].heightMin}" /></label>
        <label class="texture-slot-param"><span>High</span><input data-slot-high="${i}" type="number" min="0" max="128" step="1" value="${textureSlots[i].heightMax}" /></label>
      </div>
      <div class="texture-slot-normal">
        <button class="texture-normal-load" type="button">+ Normal map</button>
        <button class="texture-normal-clear" type="button" title="clear normal map">✕</button>
      </div>
    `;
    card.querySelector(".texture-preview")!.addEventListener("click", () => {
      pendingTextureLoad = i;
      textureInput.multiple = false;
      textureInput.click();
    });
    card.querySelector(".texture-normal-load")!.addEventListener("click", () => {
      pendingNormalLoad = i;
      normalInput.click();
    });
    card.querySelector(".texture-normal-clear")!.addEventListener("click", () => {
      clearSlotNormal(i);
      refreshTextureState();
    });
    slotCards.push(card);
    slotGrid.appendChild(card);
  }
  syncTextureModalControls = () => {
    for (let i = 0; i < textureSlots.length; i++) {
      const low = textureModal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`);
      const high = textureModal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`);
      const scale = textureModal.querySelector<HTMLInputElement>(`[data-slot-scale="${i}"]`);
      const select = textureModal.querySelector<HTMLSelectElement>(`[data-slot-texture="${i}"]`);
      if (low) low.value = String(textureSlots[i].heightMin);
      if (high) high.value = String(textureSlots[i].heightMax);
      if (scale) scale.value = String(textureSlots[i].scale);
      if (select) select.value = textureSlots[i].selectedId;
    }
  };
  for (let i = 0; i < textureSlots.length; i++) {
    textureModal.querySelector<HTMLSelectElement>(`[data-slot-texture="${i}"]`)!.addEventListener("change", async (event) => {
      const select = event.target as HTMLSelectElement;
      const selectedId = select.value;
      if (selectedId === "") {
        clearTextureSlot(i);
        refreshTextureState();
        return;
      }
      if (selectedId === "custom") {
        pendingTextureLoad = i;
        textureInput.multiple = false;
        textureInput.click();
        syncTextureModalControls();
        return;
      }
      const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === selectedId);
      if (!builtin) return;
      const previousName = textureSlots[i].name;
      textureSlots[i].name = "loading...";
      updateTextureSlotPreview(i);
      const texture = await loadTerrainTextureUrl(builtin.url);
      if (!texture) {
        textureSlots[i].name = previousName;
        select.value = textureSlots[i].selectedId;
        refreshTextureState();
        return;
      }
      setBuiltinTextureSlot(i, texture, builtin.label, builtin.url, builtin.id);
      refreshTextureState();
    });
    textureModal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`)!.addEventListener("change", (event) => {
      textureSlots[i].heightMin = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    });
    textureModal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`)!.addEventListener("change", (event) => {
      textureSlots[i].heightMax = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    });
    textureModal.querySelector<HTMLInputElement>(`[data-slot-scale="${i}"]`)!.addEventListener("change", (event) => {
      textureSlots[i].scale = Number((event.target as HTMLInputElement).value);
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
  const loadBuiltinTextureSlots = async (
    slots: readonly { index: number; selectedId: string; name: string }[],
    phaseLabel: string,
  ) => {
    if (slots.length === 0) return;
    buildProgress.hidden = false;
    buildProgressPhase.textContent = phaseLabel;
    buildProgressPercent.textContent = "90%";
    buildProgressBar.value = 0.9;
    for (const slot of slots) {
      const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === slot.selectedId);
      if (!builtin) throw new Error(`Unknown texture ${slot.selectedId}`);
      const texture = await loadTerrainTextureUrl(builtin.url);
      if (!texture) throw new Error(`Could not load texture ${slot.name}`);
      setBuiltinTextureSlot(slot.index, texture, slot.name, builtin.url, builtin.id);
    }
  };
  if (stagedImport) {
    await loadBuiltinTextureSlots(
      stagedImport.manifest.textures.filter((slot) => slot.source === "builtin").map((slot) => ({
        index: slot.index,
        selectedId: slot.selectedId,
        name: slot.name,
      })),
      "restoring textures",
    );
    for (const imported of stagedImport.manifest.textures) {
      if (imported.source === "builtin") continue;
      if (imported.source === "custom" && imported.customPath) {
        const bytes = stagedImport.customTextures.get(imported.customPath);
        if (!bytes) throw new Error(`Imported project is missing ${imported.customPath}`);
        const mimeType = imported.mimeType ?? "application/octet-stream";
        const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeType }));
        const texture = await loadTerrainTextureUrl(previewUrl);
        if (!texture) {
          URL.revokeObjectURL(previewUrl);
          throw new Error(`Could not decode imported texture ${imported.name}`);
        }
        setTextureSlot(
          imported.index,
          texture,
          imported.name,
          previewUrl,
          bytes,
          mimeType,
          imported.customPath.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin",
        );
      }
    }
    // Restore normal maps after albedo, since the albedo setters reset the slot object.
    // Normals attach to builtin or custom slots alike, so this pass is independent.
    for (const imported of stagedImport.manifest.textures) {
      if (!imported.normalPath) continue;
      const bytes = stagedImport.customTextures.get(imported.normalPath);
      if (!bytes) throw new Error(`Imported project is missing ${imported.normalPath}`);
      const mimeType = imported.normalMimeType ?? "application/octet-stream";
      const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeType }));
      const texture = await new Promise<THREE.Texture | null>((resolve) => {
        new THREE.TextureLoader().load(previewUrl, (t) => { configureNormalTexture(t); resolve(t); }, undefined, () => resolve(null));
      });
      if (!texture) {
        URL.revokeObjectURL(previewUrl);
        throw new Error(`Could not decode imported normal map for slot ${imported.index}`);
      }
      setSlotNormal(
        imported.index,
        texture,
        previewUrl,
        bytes,
        mimeType,
        imported.normalPath.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ".bin",
      );
    }
  } else {
    await loadBuiltinTextureSlots(
      DEFAULT_TERRAIN_TEXTURE_PRESETS.map((preset, index) => ({
        index,
        selectedId: preset.id,
        name: BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === preset.id)?.label ?? preset.id,
      })),
      "loading textures",
    );
  }
  syncTextureModalControls();
  updateTextureSlotPreviews();
  refreshTextureState();
  buildProgress.hidden = true;

  const textureFolder = gui.addFolder("terrain texture");
  textureFolder.add(state, "albedo").name("albedo").onChange(applyTerrainTextures);
  textureFolder.add(textureActions, "loadTexture").name("load albedo / normals");
  textureFolder.add(state, "triplanar").name("triplanar").onChange(applyTerrainTextures);
  textureFolder.add(state, "normalMap").name("normal maps").onChange(applyTerrainTextures);
  textureFolder.add(state, "normalIntensity", 0, 3, 0.05).name("normal intensity").onChange(applyTerrainTextures);
  textureFolder.add(state, "textureScale", 0.25, 4, 0.05).name("scale multiplier").onChange(applyTerrainTextures);
  textureFolder.add(state, "textureBlendMode", TEXTURE_BLEND_MODES).name("blend mode").onChange(applyTerrainTextures);
  textureFolder.add(state, "textureBlendWidth", 0, 24, 0.5).name("blend height").onChange(applyTerrainTextures);
  loadedTextureController = textureFolder.add(state, "loadedTextureFiles").name("loaded").disable();
  textureFolder.add(textureActions, "clearTexture").name("clear texture");
  const bubbleFolder = gui.addFolder("near-field bubble (§4.4)");
  bubbleFolder.add(state, "bubble").name("enable (raw chunks)").onChange(updateSelection);
  bubbleFolder.add(state, "bubbleRadius", 16, 160, 1).name("radius (cells)").onChange(updateSelection);
  bubbleFolder.add(state, "tintBubble").name("tint bubble red").onChange((on: boolean) => {
    for (const { mats } of chunkGroups.values())
      for (const m of mats) (m.uniforms.uColor.value as THREE.Color).set(on ? 0xc94b4b : 0xffffff);
  });
  const digFolder = gui.addFolder("digging");
  digFolder.add(state, "digEnabled").name("dig on click").onChange(updateInfo);
  const digRadiusController = digFolder
    .add(state, "digRadius", 1, 8, 0.5)
    .name("radius (cells)")
    .onChange(updateInfo);
  // Mirror the engine's Shift+scroll radius adjustment while playing (orbit scroll = zoom).
  window.addEventListener("wheel", (event) => {
    if (interaction.mode !== "playing" || !event.shiftKey) return;
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX; // Shift+wheel maps to deltaX on Windows
    if (delta === 0) return;
    state.digRadius = THREE.MathUtils.clamp(state.digRadius - Math.sign(delta) * 0.5, 1, 8);
    digRadiusController.updateDisplay();
    syncTerraformMenu();
    updateInfo();
  });

  // ---- bottom-left terraform menu: material palette + optional brush/sculpt edit ----
  // Material swatches map to terrain texture slots 0..3 (what `add` deposits paint with);
  // brush controls drive the same global state the click handlers and preview read.
  const PAINT_SWATCH_COLORS = ["#6b9b4d", "#8c8580", "#d9c78d", "#f5f7ff"];
  const terraformMenu = document.getElementById("terraform-menu")!;
  const paletteSection = document.createElement("div");
  paletteSection.className = "tf-palette";
  const editToggle = document.createElement("label");
  editToggle.className = "tf-edit-toggle";
  editToggle.title = "Show brush and sculpt controls";
  const editToggleInput = document.createElement("input");
  editToggleInput.type = "checkbox";
  editToggleInput.checked = true;
  terraformEditCheckbox = editToggleInput;
  editToggle.append(editToggleInput, document.createTextNode(" Edit"));
  editToggleInput.addEventListener("change", () => {
    document.body.dataset.tfEdit = editToggleInput.checked ? "true" : "false";
  });
  paletteSection.appendChild(editToggle);
  terraformMenu.appendChild(paletteSection);
  const editSection = document.createElement("div");
  editSection.className = "tf-edit-section";
  terraformMenu.appendChild(editSection);
  document.body.dataset.tfEdit = "true";

  const makeRow = (label: string, parent: HTMLElement = terraformMenu) => {
    const row = document.createElement("div");
    row.className = "tf-row";
    const tag = document.createElement("span");
    tag.className = "tf-label";
    tag.textContent = label;
    row.appendChild(tag);
    parent.appendChild(row);
    return row;
  };

  const materialRow = makeRow("Material", paletteSection);
  const swatchButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tf-swatch";
    const name = document.createElement("span");
    btn.appendChild(name);
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.brushMaterial = i;
      refreshTerraformSwatches();
    });
    swatchButtons.push(btn);
    materialRow.appendChild(btn);
  }

  const makeToggleGroup = <T extends string>(
    row: HTMLElement,
    options: { value: T; label: string }[],
    get: () => T,
    set: (v: T) => void,
  ) => {
    const buttons = options.map(({ value, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        set(value);
        sync();
      });
      row.appendChild(btn);
      return { value, btn };
    });
    const sync = () => {
      for (const { value, btn } of buttons) btn.setAttribute("aria-pressed", String(get() === value));
    };
    sync();
    return sync;
  };

  // Brush row: size slider on the left, then op + shape toggles.
  const brushRow = makeRow("Brush", editSection);
  const sizeWrap = document.createElement("div");
  sizeWrap.className = "tf-size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "1"; sizeInput.max = "8"; sizeInput.step = "0.5";
  sizeInput.value = String(state.digRadius);
  const sizeOut = document.createElement("output");
  sizeOut.textContent = String(state.digRadius);
  sizeInput.addEventListener("input", () => {
    state.digRadius = Number(sizeInput.value);
    sizeOut.textContent = String(state.digRadius);
    digRadiusController.updateDisplay();
    updateInfo();
  });
  sizeWrap.append(sizeInput, sizeOut);
  brushRow.appendChild(sizeWrap);

  const sizeGap = document.createElement("span");
  sizeGap.style.width = "8px";
  brushRow.appendChild(sizeGap);

  const syncOp = makeToggleGroup<BrushOp>(
    brushRow,
    [{ value: "remove", label: "Dig" }, { value: "add", label: "Raise" }],
    () => state.brushOp,
    (v) => { state.brushOp = v; updateInfo(); },
  );
  const spacer = document.createElement("span");
  spacer.style.width = "6px";
  brushRow.appendChild(spacer);
  makeToggleGroup<BrushShape>(
    brushRow,
    [{ value: "sphere", label: "Sphere" }, { value: "cube", label: "Cube" }, { value: "cylinder", label: "Cyl" }],
    () => state.brushShape,
    (v) => { state.brushShape = v; },
  );

  // labelled slider (label · range · value); returns its sync fn for external updates
  const makeSlider = (
    parent: HTMLElement,
    label: string,
    min: number, max: number, step: number,
    get: () => number, set: (v: number) => void,
    fmt: (v: number) => string = String,
  ) => {
    const group = document.createElement("div");
    group.className = "tf-slider";
    const lab = document.createElement("span");
    lab.className = "tf-slider-label";
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const out = document.createElement("output");
    out.textContent = fmt(get());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      out.textContent = fmt(v);
      updateInfo();
    });
    group.append(lab, input, out);
    parent.appendChild(group);
    return () => { input.value = String(get()); out.textContent = fmt(get()); };
  };

  // sculpt sliders: how hard, how tall, how soft the edge, how fast when held
  const sculptRow = makeRow("Sculpt", editSection);
  sculptRow.classList.add("tf-row-sculpt");
  const syncStrength = makeSlider(
    sculptRow, "Strength", 0, 1, 0.05,
    () => state.brushStrength, (v) => { state.brushStrength = v; }, (v) => v.toFixed(2),
  );
  const syncHeight = makeSlider(
    sculptRow, "Height", 1, 16, 0.5,
    () => state.brushHeight, (v) => { state.brushHeight = v; },
  );
  const syncFalloff = makeSlider(
    sculptRow, "Falloff", 0, 1, 0.05,
    () => state.brushFalloff, (v) => { state.brushFalloff = v; }, (v) => v.toFixed(2),
  );
  const syncFlow = makeSlider(
    sculptRow, "Flow", 80, 600, 20,
    () => state.brushFlowMs, (v) => { state.brushFlowMs = v; }, (v) => `${v}ms`,
  );

  refreshTerraformSwatches = () => {
    rebuildActiveTerrainSlots();
    const active = activeTerrainSlots.length;
    // with textures loaded, only painted slots that have a texture are selectable (else black)
    if (active > 0 && state.brushMaterial >= active) state.brushMaterial = 0;
    for (let i = 0; i < swatchButtons.length; i++) {
      const btn = swatchButtons[i];
      const slot = activeTerrainSlots[i];
      const label = btn.firstChild as HTMLSpanElement;
      btn.disabled = active > 0 && i >= active;
      btn.style.backgroundImage = slot?.previewUrl ? `url("${slot.previewUrl}")` : "";
      btn.style.backgroundColor = slot?.previewUrl ? "transparent" : PAINT_SWATCH_COLORS[i];
      label.textContent = slot?.name && slot.name !== "empty" ? slot.name : TERRAIN_TEXTURE_BANDS[i];
      btn.setAttribute("aria-pressed", String(state.brushMaterial === i && !btn.disabled));
    }
  };
  // keep the slider/op in sync if state changes elsewhere (e.g. Shift+wheel radius)
  syncTerraformMenu = () => {
    sizeInput.value = String(state.digRadius);
    sizeOut.textContent = String(state.digRadius);
    syncOp();
    syncStrength(); syncHeight(); syncFalloff(); syncFlow();
  };
  refreshTerraformSwatches();

  const currentProjectState = (): ProjectSessionState => ({
    thresholdPx: state.thresholdPx,
    enforce21: state.enforce21,
    freeze: state.freeze,
    wireframe: state.wireframe,
    showBounds: state.showBounds,
    showSeamPoints: state.showSeamPoints,
    showCrossLodBorders: state.showCrossLodBorders,
    colorByLod: state.colorByLod,
    normalColor: state.normalColor,
    normalDivergence: state.normalDivergence,
    divergenceGain: state.divergenceGain,
    frontSideOnly: state.frontSideOnly,
    recomputedNormals: state.recomputedNormals,
    forceMaxLevel: state.forceMaxLevel as ProjectSessionState["forceMaxLevel"],
    textureScale: state.textureScale,
    triplanar: state.triplanar,
    albedo: state.albedo,
    normalMap: state.normalMap,
    normalIntensity: state.normalIntensity,
    textureBlendMode: state.textureBlendMode,
    textureBlendWidth: state.textureBlendWidth,
    terrainBrightness: state.terrainBrightness,
    terrainContrast: state.terrainContrast,
    terrainSaturation: state.terrainSaturation,
    terrainWarmth: state.terrainWarmth,
    sunAzimuthDeg: state.sunAzimuthDeg,
    sunElevationDeg: state.sunElevationDeg,
    sunIntensity: state.sunIntensity,
    skyIntensity: state.skyIntensity,
    groundIntensity: state.groundIntensity,
    exposure: state.exposure,
    horizonSoftness: state.horizonSoftness,
    sunDiskIntensity: state.sunDiskIntensity,
    sunGlowIntensity: state.sunGlowIntensity,
    hazeIntensity: state.hazeIntensity,
    postProcessEnabled: state.postProcessEnabled,
    postProcessOpacity: state.postProcessOpacity,
    postProcessExposure: state.postProcessExposure,
    postProcessContrast: state.postProcessContrast,
    postProcessSaturation: state.postProcessSaturation,
    postProcessVignette: state.postProcessVignette,
    postProcessDebugMode: state.postProcessDebugMode,
    bubble: state.bubble,
    bubbleRadius: state.bubbleRadius,
    tintBubble: state.tintBubble,
    digEnabled: state.digEnabled,
    digRadius: state.digRadius,
    brushOp: state.brushOp,
    brushShape: state.brushShape,
    brushMaterial: state.brushMaterial,
    brushHeight: state.brushHeight,
    brushStrength: state.brushStrength,
    brushFalloff: state.brushFalloff,
    brushFlowMs: state.brushFlowMs,
    grassEnabled: state.grassEnabled,
    grassDistance: state.grassDistance,
    grassBladeSpacing: state.grassBladeSpacing,
    grassBladeHeight: state.grassBladeHeight,
    grassBladeHeightVariation: state.grassBladeHeightVariation,
    grassBladeWidth: state.grassBladeWidth,
    grassWindStrength: state.grassWindStrength,
    grassWindSpeed: state.grassWindSpeed,
    grassSlopeMinY: state.grassSlopeMinY,
    grassMinHeight: state.grassMinHeight,
    grassMaxHeight: state.grassMaxHeight,
    grassMaxBlades: state.grassMaxBlades,
    grassSeed: state.grassSeed,
  });

  const projectTextureMetadata = (): ProjectTextureSlot[] => textureSlots.map((slot, index) => {
    const source: ProjectTextureSlot["source"] = slot.texture === null
      ? "empty"
      : slot.selectedId === "custom" ? "custom" : "builtin";
    const customPath = source === "custom" ? `textures/slot-${index}${slot.customExtension ?? ".bin"}` : undefined;
    // Normal maps persist for any slot that has one (builtin or custom albedo), since
    // there are no builtin normals — they are always a user-loaded file.
    const normalPath = slot.normalBytes ? `textures/slot-${index}-normal${slot.normalExtension ?? ".bin"}` : undefined;
    return {
      index,
      source,
      name: source === "empty" ? "empty" : slot.name,
      selectedId: source === "empty" ? "" : slot.selectedId,
      scale: slot.scale,
      heightMin: slot.heightMin,
      heightMax: slot.heightMax,
      ...(customPath ? { customPath, mimeType: slot.customMimeType ?? "application/octet-stream" } : {}),
      ...(normalPath ? { normalPath, normalMimeType: slot.normalMimeType ?? "application/octet-stream" } : {}),
    };
  });

  const setProjectBusy = (busy: boolean, phase = "preparing", fraction = 0) => {
    importButton.disabled = busy;
    exportButton.disabled = busy;
    buildProgress.hidden = !busy;
    buildProgressPhase.textContent = phase;
    buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
    buildProgressBar.value = fraction;
  };

  const showProjectError = (operation: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    lastArchiveSummary = `${operation} failed: ${message}`;
    updateInfo();
    window.alert(`${operation} failed\n\n${message}`);
  };

  const validateArchiveTextures = async (contents: ProjectArchiveContents) => {
    for (const slot of contents.manifest.textures) {
      if (slot.source === "builtin" && !BUILTIN_TERRAIN_TEXTURES.some((texture) => texture.id === slot.selectedId)) {
        throw new Error(`project.json references unknown built-in texture ${slot.selectedId}`);
      }
      if (slot.source !== "custom" || !slot.customPath) continue;
      const bytes = contents.customTextures.get(slot.customPath);
      if (!bytes) throw new Error(`The archive is missing ${slot.customPath}`);
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
        type: slot.mimeType ?? "application/octet-stream",
      });
      const previewUrl = URL.createObjectURL(blob);
      try {
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          const timeout = window.setTimeout(() => reject(new Error("image decode timed out")), 5_000);
          image.onload = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          image.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error("image decode failed"));
          };
          image.src = previewUrl;
        });
      } catch {
        throw new Error(`Custom texture ${slot.name} is not a decodable image`);
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    }
  };

  importButton.addEventListener("click", () => projectImportInput.click());
  projectImportInput.addEventListener("change", async () => {
    const file = projectImportInput.files?.[0];
    projectImportInput.value = "";
    if (!file) return;
    try {
      setProjectBusy(true, "validating project archive", 0.2);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const contents = await parseProjectArchive(new Uint8Array(await file.arrayBuffer()));
      await validateArchiveTextures(contents);
      setProjectBusy(true, "staging project for rebuild", 0.65);
      const token = await stageProjectImport(contents);
      const next = new URLSearchParams(location.search);
      next.set("world", String(contents.manifest.worldSize));
      next.set("import", token);
      location.search = `?${next.toString()}`;
    } catch (error) {
      setProjectBusy(false);
      showProjectError("Project import", error);
    }
  });

  exportButton.addEventListener("click", async () => {
    const startedAt = performance.now();
    try {
      setProjectBusy(true, "settling edited LODs", 0.05);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      flushAncestors();
      setProjectBusy(true, "exporting all LOD meshes", 0.25);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { exportAllLodsToGlb } = await import("./gltf_export.js");
      const terrainGlb = await exportAllLodsToGlb(result.nodesByLevel);
      setProjectBusy(true, "packing project archive", 0.8);
      const textures = projectTextureMetadata();
      const customTextures = new Map<string, Uint8Array>();
      for (const texture of textures) {
        if (texture.source === "custom" && texture.customPath) {
          const bytes = textureSlots[texture.index].customBytes;
          if (!bytes) throw new Error(`Custom texture slot ${texture.index} has no source bytes`);
          customTextures.set(texture.customPath, bytes);
        }
        if (texture.normalPath) {
          const bytes = textureSlots[texture.index].normalBytes;
          if (!bytes) throw new Error(`Normal-map slot ${texture.index} has no source bytes`);
          customTextures.set(texture.normalPath, bytes);
        }
      }
      const manifest: ClodProjectManifestV1 = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        kind: "drusniel-clod-project",
        exportedAt: new Date().toISOString(),
        worldSize: WORLD,
        config: structuredClone(cfg),
        state: currentProjectState(),
        terrainEdits: getDigEditsSnapshot(),
        textures,
        camera: {
          position: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
        },
      };
      const archive = await createProjectArchive(manifest, terrainGlb, customTextures);
      setProjectBusy(true, "downloading project", 1);
      const url = URL.createObjectURL(new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: "application/zip" }));
      const link = document.createElement("a");
      const stamp = manifest.exportedAt.replace(/[:.]/g, "-");
      link.href = url;
      link.download = `drusniel-clod-world-${WORLD}-${stamp}.zip`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const elapsed = performance.now() - startedAt;
      lastArchiveSummary = `export: ${(archive.byteLength / 1048576).toFixed(1)} MiB in ${(elapsed / 1000).toFixed(2)}s`;
      console.info(`[project export] ${lastArchiveSummary}; GLB ${(terrainGlb.byteLength / 1048576).toFixed(1)} MiB`);
      updateInfo();
    } catch (error) {
      showProjectError("Project export", error);
    } finally {
      setProjectBusy(false);
    }
  });

  // Imported controller values need the same side effects as interactive GUI changes.
  forEachTerrainMaterial((material) => {
    material.wireframe = state.wireframe;
    material.uniforms.uNormalColor.value = state.normalColor;
    material.uniforms.uNormalDivergence.value = state.normalDivergence;
    material.uniforms.uDivergenceGain.value = state.divergenceGain;
    material.side = state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide;
  });
  for (const view of views.values()) {
    (view.mat.uniforms.uColor.value as THREE.Color).set(
      state.colorByLod ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8,
    );
    if (state.recomputedNormals) {
      view.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(view.recomputedNormals, 3));
    }
  }
  applyColorAdjustmentsToTerrain();
  updateLighting();
  applyTerrainTextures();
  grassSystem.setEnabled(state.grassEnabled);
  grassSystem.updateSettings(makeGrassSettings());
  updateSelection();
  updateInfo();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess.setSize(window.innerWidth, window.innerHeight);
  });

  let elapsedSeconds = 0;
  renderer.setAnimationLoop(() => {
    const playerDelta = Math.min(playerClock.getDelta(), 0.1);
    elapsedSeconds += playerDelta;
    updateAverageFps();
    if (interaction.mode === "playing") {
      playerForward.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
      player.update(playerDelta, playerInput, playerForward);
      camera.position.copy(player.position).addScaledVector(THREE.Object3D.DEFAULT_UP, DEFAULT_PLAYER_CONFIG.eyeHeight);
      camera.rotation.set(playerPitch, playerYaw, 0, "YXZ");
    } else {
      controls.update();
    }
    skyEnvironment.updateCamera(camera);
    if (!state.freeze) updateSelection();

    // pay down any deferred ancestor re-simplification from recent digs
    drainAncestors();

    // hold-to-dig pickaxe cadence while playing
    if (
      interaction.mode === "playing" && digHeld && state.digEnabled &&
      document.pointerLockElement === renderer.domElement &&
      performance.now() - lastDigAt >= state.brushFlowMs
    ) {
      camera.getWorldDirection(digDirection);
      performDig(new THREE.Ray(camera.position.clone(), digDirection.clone()));
    }

    // dig preview reticle at the current aim point
    let digAimHit: TerrainSurfaceHit | null = null;
    if (state.digEnabled && interaction.mode === "playing") {
      camera.getWorldDirection(digDirection);
      digAimRay.origin.copy(camera.position);
      digAimRay.direction.copy(digDirection);
      digAimHit = terrainColliders.raycastSurface(digAimRay);
    } else if (state.digEnabled && interaction.mode === "orbit" && hoverPointerValid) {
      playerRaycaster.setFromCamera(hoverPointer, camera);
      digAimHit = terrainColliders.raycastSurface(playerRaycaster.ray);
    }
    if (digAimHit) {
      digPreview.position.copy(digAimHit.point);
      digPreview.scale.set(state.digRadius, state.brushHeight, state.digRadius);
      digPreview.geometry = brushPreviewGeometries[state.brushShape];
      (digPreview.material as THREE.MeshBasicMaterial).color.setHex(
        state.brushOp === "add" ? 0x55dd66 : 0xff5533,
      );
    }
    digPreview.visible = digAimHit !== null;

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
          (interaction.mode === "playing" ? player.position.x : controls.target.x) - (v.node.footprint.minX + v.node.footprint.maxX) / 2,
          (interaction.mode === "playing" ? player.position.z : controls.target.z) - (v.node.footprint.minZ + v.node.footprint.maxZ) / 2,
        ) < state.bubbleRadius;
      if (owned) {
        v.mesh.visible = false;
        ensureChunkGroup(v.node).group.visible = true;
      } else {
        const grp = chunkGroups.get(v.node.id);
        if (grp) grp.group.visible = false;
      }
    }
    const grassCenter = interaction.mode === "playing" ? player.position : controls.target;
    grassSystem.update(elapsedSeconds, grassCenter);
    const grassBladeCount = grassSystem.getBladeCount();
    if (grassBladeCount !== state.grassBladeCount) {
      state.grassBladeCount = grassBladeCount;
      grassBladeCountController?.updateDisplay();
    }
    postProcess.updateSettings(currentPostProcessSettings());
    postProcess.render(scene, camera);
  });
  window.addEventListener("beforeunload", () => {
    grassSystem.dispose();
    skyEnvironment.dispose();
    postProcess.dispose();
  }, { once: true });
}

main().catch((e) => {
  const buildProgress = document.getElementById("build-progress");
  if (buildProgress) buildProgress.hidden = true;
  document.getElementById("info")!.textContent = "build failed: " + (e?.message ?? e);
  console.error(e);
});
