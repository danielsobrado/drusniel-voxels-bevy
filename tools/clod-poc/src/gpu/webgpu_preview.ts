// Phase 2c WebGPU app path (docs/webgpu-migration.md). Reached via `?webgpu=1`.
//
// Parallel-path migration strategy: this grows the isolated WebGPU viewer toward the real
// app, reusing the pure logic (buildWorld + selectCut) but with its own slim render path, so
// the WebGL app stays untouched. It now does real camera-driven CLOD selection: as the
// camera moves, selectCut chooses the adaptive cut each frame and the matching terrain
// meshes are shown, rendered through WebGPURenderer with the ported terrain NodeMaterial.
//
// Not yet here (later 2c steps / Phase 3+): the full GUI, LOD cross-fade dither,
// grass v2, and worker-backed edit scheduling.
// Dynamically imported (see main.ts) so `three/webgpu` stays out of the normal bundle.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { WebGPURenderer } from "three/webgpu";
import { parseConfig } from "../config.js";
import { buildWorld, rebuildDirtyPages } from "../quadtree.js";
import { initSimplifier } from "../simplify.js";
import { selectCut, type SelectionParams, type SelectionState } from "../selection.js";
import { DEFAULT_GRASS_SETTINGS, generateGrassInstances } from "../grass.js";
import { DEFAULT_STONE_SETTINGS } from "../stones/stone_config.js";
import { StoneSystem, type StoneLighting } from "../stones/stone_instances.js";
import {
  addDigEdit,
  clearDigEdits,
  DIG_INFLUENCE_MARGIN,
  PAINT_BLEND_CHANNELS,
  paintWeightsAt,
  type DigEdit,
} from "../terrain.js";
import { TerrainColliderSet } from "../terrain_collider.js";
import { parseProceduralTextureConfig } from "../textures/materialRecipes.js";
import { createProceduralTerrainTextures } from "../textures/terrainTextureArrays.js";
import type { ClodPageNode, PageMesh } from "../types.js";
import configText from "../../config/clod_pages.yaml?raw";
import proceduralConfigText from "../../config/procedural_textures.yaml?raw";
import {
  buildGrassInstancedGeometry,
  createGrassNodeMaterial,
  grassMidInstances,
  GRASS_V2_MID_DISTANCE_FRACTION,
  GRASS_V2_NEAR_DISTANCE_FRACTION,
} from "./grass_node_material.js";
import { createStoneNodeMaterial } from "./stone_node_material.js";
import { WebGpuPostProcessPipeline } from "./webgpu_postprocess.js";
import {
  createTerrainNodeMaterial,
  type TerrainNodeMaterialHandle,
} from "./terrain_node_material.js";
import { createSkyNodeMaterial } from "./sky_node_material.js";

interface PaintAttributeCache {
  slots: Float32Array;
  weights: Float32Array;
}

const paintAttributeCache = new WeakMap<PageMesh, PaintAttributeCache>();

function paintAttributesFor(mesh: PageMesh): PaintAttributeCache {
  const cached = paintAttributeCache.get(mesh);
  if (cached) return cached;
  const vertexCount = mesh.positions.length / 3;
  const slots = new Float32Array(vertexCount * PAINT_BLEND_CHANNELS);
  const weights = new Float32Array(vertexCount * PAINT_BLEND_CHANNELS);
  for (let i = 0; i < vertexCount; i++) {
    const p = paintWeightsAt(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
    for (let c = 0; c < PAINT_BLEND_CHANNELS; c++) {
      slots[i * PAINT_BLEND_CHANNELS + c] = p.slots[c];
      weights[i * PAINT_BLEND_CHANNELS + c] = p.weights[c];
    }
  }
  const built = { slots, weights };
  paintAttributeCache.set(mesh, built);
  return built;
}

function terrainGeometry(node: ClodPageNode): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(node.mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(node.mesh.normals, 3));
  const { slots: paintSlots, weights: paintWeights } = paintAttributesFor(node.mesh);
  g.setAttribute("paintSlots", new THREE.BufferAttribute(paintSlots, PAINT_BLEND_CHANNELS));
  g.setAttribute("paintWeights", new THREE.BufferAttribute(paintWeights, PAINT_BLEND_CHANNELS));
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
  clearDigEdits();
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

  // Optional texture-array path (?tex=1): use the same generated procedural terrain
  // texture arrays and height bands as the normal WebGL app's procedural material source.
  const useTextures = searchParams.get("tex") === "1";
  const useNormalMaps = useTextures && searchParams.get("normal") === "1";
  const useTextureParity = useTextures && searchParams.get("texParity") === "1";
  const proceduralTextureConfig = parseProceduralTextureConfig(proceduralConfigText);
  const proceduralTerrain = useTextures && proceduralTextureConfig.enabled
    ? createProceduralTerrainTextures(proceduralTextureConfig)
    : null;
  const slots = proceduralTerrain?.slots.map((slot) => ({
    scale: slot.scale,
    heightMin: slot.heightMin,
    heightMax: slot.heightMax,
  })) ?? [];
  const terrainMaterialOptions = {
    // Light the terrain with the sky's sun/sky/ground so the two agree.
    lighting: {
      lightDir: sky.lighting.sunDirection,
      sunColor: sky.lighting.sunColor,
      skyLight: sky.lighting.skyLight,
      groundLight: sky.lighting.groundLight,
      baseColor: new THREE.Color(0xb9c0c8),
      roughness: 0.9,
    },
    textures: useTextures && proceduralTerrain
      ? {
          albedoArray: proceduralTerrain.albedoArray,
          normalArray: useNormalMaps ? proceduralTerrain.normalArray : null,
          slots,
          blendBands: true,
          blendWidth: 2.5,
          normalIntensity: proceduralTextureConfig.terrain.micro_normal.max_strength,
          procedural: useTextureParity
            ? {
                noiseA: proceduralTerrain.noise.noiseA,
                noiseB: proceduralTerrain.noise.noiseB,
                microFadeStart: proceduralTextureConfig.terrain.micro_normal.fade_start_m,
                microFadeEnd: proceduralTextureConfig.terrain.micro_normal.fade_end_m,
                lodBias: 0,
              }
            : null,
        }
      : null,
  };
  const makeTerrainMaterial = (): TerrainNodeMaterialHandle => createTerrainNodeMaterial(terrainMaterialOptions);

  interface TerrainView {
    mesh: THREE.Mesh;
    material: TerrainNodeMaterialHandle;
    fade: number;
    target: number;
  }

  // LOD cross-fade needs a per-view uFade uniform, so each view gets its own material then.
  // With fades off (the default) every view can share one material — far fewer node-graph
  // pipeline compilations and much less GPU memory when the cut is large.
  const useLodFade = searchParams.get("lodFade") === "1";
  let sharedTerrainMaterial: TerrainNodeMaterialHandle | null = null;

  // Lazily realise one mesh per node. Visibility is driven by the cut.
  const views = new Map<string, TerrainView>();
  const viewFor = (node: ClodPageNode): TerrainView => {
    let view = views.get(node.id);
    if (!view) {
      const terrainMaterial = useLodFade
        ? makeTerrainMaterial()
        : (sharedTerrainMaterial ??= makeTerrainMaterial());
      const mesh = new THREE.Mesh(terrainGeometry(node), terrainMaterial.material);
      mesh.visible = false;
      scene.add(mesh);
      view = { mesh, material: terrainMaterial, fade: 0, target: 0 };
      views.set(node.id, view);
    }
    return view;
  };
  const replaceNodeGeometry = (node: ClodPageNode): void => {
    const view = views.get(node.id);
    if (!view) return;
    view.mesh.geometry.dispose();
    view.mesh.geometry = terrainGeometry(node);
  };

  const worldCells = world * cfg.page.chunks_per_page * cfg.page.chunk_size;
  const mid = worldCells / 2;

  // Optional grass (?grass=1): blades placed on LOD0 footprints (reusing the app's
  // generateGrassInstances), rendered with the ported instanced grass NodeMaterial. Classic
  // remains the default; `grassMode=v2` opts into terrain-patch-v2 for QA.
  const useGrass = searchParams.get("grass") === "1";
  const useGrassV2 = useGrass && searchParams.get("grassMode") === "v2";
  const useGrassAlphaToCoverage = useGrassV2 && searchParams.get("grassA2C") === "1";
  const debugGrassAttributes = useGrassV2 && searchParams.get("grassDebugAttrs") === "1";
  const useGrassEdgeShape = useGrassV2 && searchParams.get("grassEdgeShape") === "1";
  let grass: ReturnType<typeof createGrassNodeMaterial> | null = null;
  let grassBlades = 0;
  let grassMidBlades = 0;
  const grassFocus = new THREE.Vector2(mid, mid);
  const grassPatches: Array<{
    near: THREE.Mesh;
    mid: THREE.Mesh | null;
    centerX: number;
    centerZ: number;
    radius: number;
  }> = [];
  if (useGrass) {
    const grassSettings = {
      ...DEFAULT_GRASS_SETTINGS,
      shaderMode: useGrassV2 ? ("terrain-patch-v2" as const) : ("classic" as const),
      alphaToCoverage: useGrassAlphaToCoverage,
    };
    grass = createGrassNodeMaterial({
      lighting: sky.lighting,
      bladeWidth: grassSettings.bladeWidth,
      windStrength: grassSettings.windStrength,
      windSpeed: grassSettings.windSpeed,
      mode: grassSettings.shaderMode,
      alphaToCoverage: grassSettings.alphaToCoverage,
      distance: grassSettings.distance,
      fadeCenter: useGrassV2 ? grassFocus : undefined,
      debugAttributes: debugGrassAttributes,
    });
    const lod0 = result.nodesByLevel.get(0) ?? [];
    for (const node of lod0) {
      const instances = generateGrassInstances(node.footprint, grassSettings);
      if (instances.length === 0) continue;
      const centerX = (node.footprint.minX + node.footprint.maxX) * 0.5;
      const centerZ = (node.footprint.minZ + node.footprint.maxZ) * 0.5;
      const radius = Math.hypot(node.footprint.maxX - node.footprint.minX, node.footprint.maxZ - node.footprint.minZ) * 0.5;
      const mesh = new THREE.Mesh(
        buildGrassInstancedGeometry(instances, {
          mode: grassSettings.shaderMode,
          tier: "near",
          crossed: useGrassV2 && grassSettings.nearCrossedQuads,
          edgeShape: useGrassEdgeShape,
        }),
        grass.material,
      );
      mesh.frustumCulled = false;
      scene.add(mesh);
      let midMesh: THREE.Mesh | null = null;
      if (useGrassV2) {
        const midInstances = grassMidInstances(instances);
        midMesh = new THREE.Mesh(
          buildGrassInstancedGeometry(midInstances, {
            mode: grassSettings.shaderMode,
            tier: "mid",
            edgeShape: useGrassEdgeShape,
          }),
          grass.material,
        );
        midMesh.frustumCulled = false;
        scene.add(midMesh);
        grassMidBlades += midInstances.length;
      }
      grassPatches.push({ near: mesh, mid: midMesh, centerX, centerZ, radius });
      grassBlades += instances.length;
    }
  }

  const updateGrassVisibility = (): void => {
    if (!useGrass || !useGrassV2) return;
    const grassDistance = DEFAULT_GRASS_SETTINGS.distance;
    for (const patch of grassPatches) {
      const distance = Math.hypot(grassFocus.x - patch.centerX, grassFocus.y - patch.centerZ);
      const nearDistance = grassDistance * GRASS_V2_NEAR_DISTANCE_FRACTION + patch.radius;
      const midDistance = grassDistance * GRASS_V2_MID_DISTANCE_FRACTION + patch.radius;
      patch.near.visible = distance <= nearDistance;
      if (patch.mid) patch.mid.visible = distance > nearDistance && distance <= midDistance;
    }
  };

  // Optional stones (?stones=1): reuse the app's StoneSystem scatter/grouping/LOD update,
  // with its internal GLSL material replaced by a TSL NodeMaterial.
  const useStones = searchParams.get("stones") === "1";
  let stones: StoneSystem | null = null;
  if (useStones) {
    const lighting: StoneLighting = {
      light: sky.lighting.sunDirection,
      sunColor: sky.lighting.sunColor,
      skyLight: sky.lighting.skyLight,
      groundLight: sky.lighting.groundLight,
    };
    const stoneMaterial = createStoneNodeMaterial(lighting);
    stones = new StoneSystem({
      scene,
      nodes: allNodes,
      worldCells,
      settings: { ...DEFAULT_STONE_SETTINGS, enabled: true },
      lighting,
      material: stoneMaterial.material,
    });
  }

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);
  camera.position.set(mid, worldCells * 0.7, mid + worldCells * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(mid, 24, mid);
  controls.update();

  const usePost = searchParams.get("post") === "1";
  const postProcess = usePost ? new WebGpuPostProcessPipeline(renderer, scene, camera) : null;
  const fadeFrames = Number(searchParams.get("lodFadeFrames"));
  const fadeStep = 1 / (Number.isFinite(fadeFrames) ? THREE.MathUtils.clamp(fadeFrames, 2, 60) : 12);
  const useDig = searchParams.get("dig") === "1";
  const requestedDigRadius = Number(searchParams.get("digRadius"));
  const digRadius = Number.isFinite(requestedDigRadius) ? THREE.MathUtils.clamp(requestedDigRadius, 1, 8) : 3;
  const digOp = searchParams.get("digOp") === "add" ? "add" : "remove";
  const requestedDigMaterial = Number(searchParams.get("digMaterial"));
  const digMaterial = Number.isFinite(requestedDigMaterial)
    ? Math.floor(THREE.MathUtils.clamp(requestedDigMaterial, 0, Math.max(slots.length - 1, 0)))
    : 2;
  const terrainColliders = useDig
    ? new TerrainColliderSet(
        (result.nodesByLevel.get(0) ?? []).map((node) => ({
          id: node.id,
          mesh: node.mesh,
          footprint: node.footprint,
        })),
      )
    : null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hoverPointer = new THREE.Vector2();
  let hoverPointerValid = false;
  let digPointerDown: { x: number; y: number } | null = null;
  let digInFlight = false;
  let editCount = 0;
  let lastDigSummary = "";
  const digPreview = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({
      color: digOp === "add" ? 0x66cc55 : 0xff5533,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  digPreview.visible = false;
  digPreview.frustumCulled = false;
  if (useDig) scene.add(digPreview);

  const pointerToRay = (event: PointerEvent, target: THREE.Vector2): THREE.Ray => {
    const rect = renderer.domElement.getBoundingClientRect();
    target.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(target, camera);
    return raycaster.ray;
  };

  const performDig = (ray: THREE.Ray): void => {
    if (!terrainColliders || digInFlight) return;
    const hit = terrainColliders.raycastSurface(ray);
    if (!hit) return;

    const edit: DigEdit = {
      x: hit.point.x,
      y: hit.point.y,
      z: hit.point.z,
      r: digRadius,
      shape: "sphere",
      op: digOp,
      material: digOp === "add" ? digMaterial : undefined,
    };
    addDigEdit(edit);

    const margin = digRadius + DIG_INFLUENCE_MARGIN;
    const t0 = performance.now();
    digInFlight = true;
    try {
      const rebuild = rebuildDirtyPages(
        result,
        {
          minX: hit.point.x - margin,
          maxX: hit.point.x + margin,
          minZ: hit.point.z - margin,
          maxZ: hit.point.z + margin,
        },
        cfg,
      );
      for (const node of rebuild.changed) {
        replaceNodeGeometry(node);
        if (node.level === 0) terrainColliders.updatePage(node.id, node.mesh);
      }
      // Stones are not re-scattered here: a full StoneSystem.rebuild() re-scatters the whole
      // world (cost ∝ total stones) for a local edit. They stay on the pre-edit surface.
      updateSelection();
      editCount++;
      lastDigSummary =
        `${(performance.now() - t0).toFixed(0)}ms sync (${rebuild.lod0Pages} LOD0, ${rebuild.parentNodes} parents)`;
    } catch (error) {
      lastDigSummary = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[webgpu-preview] dig failed", error);
    } finally {
      digInFlight = false;
    }
  };

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!useDig || event.button !== 0) return;
    digPointerDown = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!useDig || event.button !== 0 || !digPointerDown) return;
    const moved = Math.hypot(event.clientX - digPointerDown.x, event.clientY - digPointerDown.y);
    digPointerDown = null;
    if (moved > 4) return;
    performDig(pointerToRay(event, pointer));
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!useDig) return;
    pointerToRay(event, hoverPointer);
    hoverPointerValid = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    hoverPointerValid = false;
    digPreview.visible = false;
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess?.setSize();
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
      const view = viewFor(node);
      if (!useLodFade) {
        view.fade = 1;
        view.mesh.visible = true;
        view.material.setFade(1, true, false);
      }
      view.target = 1;
      nextVisible.add(node.id);
      triangles += node.mesh.indices.length / 3;
      perLevel.set(node.level, (perLevel.get(node.level) ?? 0) + 1);
    }
    for (const id of visibleIds) {
      if (!nextVisible.has(id)) {
        const view = views.get(id);
        if (view) {
          view.target = 0;
          if (!useLodFade) {
            view.fade = 0;
            view.mesh.visible = false;
            view.material.setFade(1, false, false);
          }
        }
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
    grassFocus.set(controls.target.x, controls.target.z);
    grass?.setFadeCenter(grassFocus.x, grassFocus.y);
    skyDome.position.copy(camera.position);
    updateGrassVisibility();
    updateSelection();
    if (useLodFade) {
      for (const view of views.values()) {
        if (view.fade < view.target) view.fade = Math.min(view.target, view.fade + fadeStep);
        else if (view.fade > view.target) view.fade = Math.max(view.target, view.fade - fadeStep);
        view.mesh.visible = view.fade > 0.001;
        // Only the incoming node dithers in; the outgoing node stays solid underneath until
        // it fully fades out, so the incoming's screen-door gaps reveal terrain, not holes.
        const fadingIn = view.target > 0.5;
        view.material.setFade(view.fade, true, fadingIn && view.fade > 0.001 && view.fade < 0.999);
      }
    }
    stones?.update(camera.position);
    if (terrainColliders && hoverPointerValid) {
      raycaster.setFromCamera(hoverPointer, camera);
      const hoverHit = terrainColliders.raycastSurface(raycaster.ray);
      if (hoverHit) {
        digPreview.position.copy(hoverHit.point);
        digPreview.scale.setScalar(digRadius);
        digPreview.visible = true;
      } else {
        digPreview.visible = false;
      }
    }
    if (postProcess) postProcess.render(scene, camera);
    else renderer.render(scene, camera);
    const stoneStats = stones?.getStats();
    overlay.textContent =
      `WebGPU CLOD preview — backend: ${backendName}\n` +
      `world: ${world}x${world}   textures: ${proceduralTerrain ? `on (app procedural${useTextureParity ? " parity" : ""})` : "off"}   normals: ${useNormalMaps && proceduralTerrain ? "on" : "off"}   lod fade: ${useLodFade ? "on" : "off"}   grass: ${useGrass ? (useGrassV2 ? `v2${useGrassAlphaToCoverage ? " a2c" : ""}${debugGrassAttributes ? " attr-debug" : ""}${useGrassEdgeShape ? " edge-shape" : ""}` : "classic") : "off"}   stones: ${useStones ? "on" : "off"}   post: ${usePost ? "on" : "off"}   dig: ${useDig ? `on ${digOp} r=${digRadius}` : "off"}\n` +
      `cut: ${renderedCount} nodes   ${levelSummary}\n` +
      `fps: ${fps.toFixed(0)}   triangles: ${triangles.toLocaleString()}` +
      (useGrass ? `   grass blades: ${grassBlades.toLocaleString()}${useGrassV2 ? ` (+${grassMidBlades.toLocaleString()} mid)` : ""}` : "") +
      (stoneStats ? `   stones: ${stoneStats.visible.toLocaleString()}/${stoneStats.total.toLocaleString()}` : "") +
      (useDig ? `\nedits: ${editCount}   last dig: ${lastDigSummary || "none"}` : "");
  });
}
