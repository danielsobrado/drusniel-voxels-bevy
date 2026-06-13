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
import { buildWorldAsync, rebuildDirtyPages } from "./quadtree.js";
import { addDigEdit, digEditCount, DIG_INFLUENCE_MARGIN, meshChunk } from "./terrain.js";
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

const LOD_COLORS = [0x9ca3ad, 0x3a6ea5, 0x49a078, 0xd98032];
const WORLD_OPTIONS = [2, 4, 8, 16, 32];
const MAX_TERRAIN_TEXTURES = 4;
const TERRAIN_TEXTURE_BANDS = ["low", "mid low", "mid high", "high"];
const DEFAULT_TEXTURE_RANGES = [
  [14, 42],
  [42, 70],
  [70, 94],
  [94, 118],
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
type TextureBlendMode = (typeof TEXTURE_BLEND_MODES)[number];

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
  selectedId: string;
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
  const orbitModeButton = document.getElementById("orbit-mode") as HTMLButtonElement;
  const playerModeButton = document.getElementById("player-mode") as HTMLButtonElement;
  const playerModeStatus = document.getElementById("player-mode-status")!;
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
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const mid = worldCells / 2;
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);

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
    playerModeStatus.textContent = interaction.mode === "choosingSpawn"
      ? "Click the terrain to choose your starting position"
      : interaction.mode === "playing"
        ? "WASD · Shift · Space · Esc · click digs · Shift+wheel radius"
        : "Orbit camera";
  };
  const exitPlayerMode = () => {
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
    } else if (interaction.mode === "playing" && playerPointerLocked) {
      playerPointerLocked = false;
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
    if (event.code === "KeyW" && playerInput.forward > 0) playerInput.forward = 0;
    if (event.code === "KeyS" && playerInput.forward < 0) playerInput.forward = 0;
    if (event.code === "KeyA" && playerInput.right < 0) playerInput.right = 0;
    if (event.code === "KeyD" && playerInput.right > 0) playerInput.right = 0;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") playerInput.sprint = false;
    if (event.code === "Space") playerInput.jump = false;
  });
  window.addEventListener("blur", resetPlayerInput);
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
    name: "empty",
    previewUrl: null,
    selectedId: "",
    scale: 1 / 64,
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
    const enabled = activeTerrainSlots.length > 0;
    const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
    const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
    const apply = (mat: THREE.ShaderMaterial) => {
      mat.uniforms.uUseTexture.value = enabled;
      mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
      mat.uniforms.uTextureScales.value.set(
        (activeTerrainSlots[0]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[1]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[2]?.scale ?? 1 / 64) * state.textureScale,
        (activeTerrainSlots[3]?.scale ?? 1 / 64) * state.textureScale,
      );
      mat.uniforms.uTextureBlendBands.value = state.textureBlendMode === "blend bands";
      mat.uniforms.uTextureBlendWidth.value = state.textureBlendWidth;
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

  // dig preview reticle: translucent sphere at the aim point, sized to the dig radius
  const digPreview = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
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
        mat.uniforms.uNormalDivergence.value = state.normalDivergence;
        mat.uniforms.uDivergenceGain.value = state.divergenceGain;
        applyTerrainColorAdjustments(mat, currentTerrainColorAdjustments());
        mat.side = state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide;
        rebuildActiveTerrainSlots();
        const textureUniforms = ["uTerrainTexture0", "uTerrainTexture1", "uTerrainTexture2", "uTerrainTexture3"];
        const rangeUniforms = ["uTextureRange0", "uTextureRange1", "uTextureRange2", "uTextureRange3"];
        mat.uniforms.uUseTexture.value = activeTerrainSlots.length > 0;
        mat.uniforms.uTerrainTextureCount.value = activeTerrainSlots.length;
        mat.uniforms.uTextureScales.value.set(
          (activeTerrainSlots[0]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[1]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[2]?.scale ?? 1 / 64) * state.textureScale,
          (activeTerrainSlots[3]?.scale ?? 1 / 64) * state.textureScale,
        );
        mat.uniforms.uTextureBlendBands.value = state.textureBlendMode === "blend bands";
        mat.uniforms.uTextureBlendWidth.value = state.textureBlendWidth;
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
      `dig: ${state.digEnabled ? "on" : "off"}  r=${state.digRadius}  edits=${digEditCount()}` +
      `${lastDigSummary ? `  last: ${lastDigSummary}` : ""}\n` +
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

  // Carve a sphere where the ray hits, then pay the CLOD edit cost synchronously:
  // rebuild the dug LOD0 pages, re-simplify their ancestors, refresh collider BVHs.
  // The timing breakdown lands in the overlay + console — that's the experiment.
  const performDig = (ray: THREE.Ray) => {
    const hit = terrainColliders.raycastSurface(ray);
    if (!hit) return;
    const radius = state.digRadius;
    addDigEdit({ x: hit.point.x, y: hit.point.y, z: hit.point.z, r: radius });
    const t0 = performance.now();
    const margin = radius + DIG_INFLUENCE_MARGIN;
    const rebuild = rebuildDirtyPages(result, {
      minX: hit.point.x - margin,
      maxX: hit.point.x + margin,
      minZ: hit.point.z - margin,
      maxZ: hit.point.z + margin,
    }, cfg);

    let colliderMs = 0;
    for (const node of rebuild.changed) {
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
      if (node.level === 0) {
        const tc = performance.now();
        const g = toGeometry(node.mesh);
        terrainColliders.updatePage(node.id, g);
        g.dispose();
        colliderMs += performance.now() - tc;
        // drop the cached raw-chunk bubble meshes; they regenerate lazily when owned
        const chunkEntry = chunkGroups.get(node.id);
        if (chunkEntry) {
          scene.remove(chunkEntry.group);
          for (const child of chunkEntry.group.children) (child as THREE.Mesh).geometry.dispose();
          for (const m of chunkEntry.mats) m.dispose();
          chunkGroups.delete(node.id);
        }
      }
    }
    const totalMs = performance.now() - t0;
    lastDigSummary =
      `${totalMs.toFixed(0)}ms (LOD0 ${rebuild.lod0Pages}p ${rebuild.lod0Ms.toFixed(0)}ms · ` +
      `parents ${rebuild.parentNodes}n ${rebuild.parentMs.toFixed(0)}ms · collider ${colliderMs.toFixed(0)}ms)`;
    console.log(
      `[dig] r=${radius} at (${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}) — ${lastDigSummary}`,
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
  const setTextureSlot = (index: number, texture: THREE.Texture, name: string, previewUrl: string) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = { ...old, texture, name, previewUrl, selectedId: "custom" };
  };
  const setBuiltinTextureSlot = (index: number, texture: THREE.Texture, name: string, previewUrl: string, selectedId: string) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = { ...old, texture, name, previewUrl, selectedId };
  };
  const clearTextureSlot = (index: number) => {
    const old = textureSlots[index];
    old.texture?.dispose();
    if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
    textureSlots[index] = { ...old, texture: null, name: "empty", previewUrl: null, selectedId: "" };
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
  const loadTerrainTexture = (file: File): Promise<{ texture: THREE.Texture; previewUrl: string } | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          configureTerrainTexture(texture);
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
      <label class="texture-slot-param">Scale <input data-slot-scale="${i}" type="number" min="${1 / 512}" max="${1 / 8}" step="${1 / 512}" value="${textureSlots[i].scale}" /></label>
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
  syncTextureModalControls();
  updateTextureSlotPreviews();

  const textureFolder = gui.addFolder("terrain texture");
  textureFolder.add(textureActions, "loadTexture").name("texture slots");
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
    updateInfo();
  });

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

    // hold-to-dig pickaxe cadence while playing
    if (
      interaction.mode === "playing" && digHeld && state.digEnabled &&
      document.pointerLockElement === renderer.domElement &&
      performance.now() - lastDigAt >= DIG_HOLD_INTERVAL_MS
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
      digPreview.scale.setScalar(state.digRadius);
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
