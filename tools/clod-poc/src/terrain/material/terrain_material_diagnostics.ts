import * as THREE from "three";
import {
  EXPECTED_BIOME_REGION_IDS,
  getBiomeTextureSlotSet,
  loadContentRegistry,
} from "../../content/index.js";
import type { TerrainTextureApplyOptions } from "../../rendering/terrain_material.js";
import { resolveTerrainTextureScale } from "./terrain_texture_scale.js";
import type {
  TerrainMaterialUiState,
  TerrainMaterialView,
} from "./terrain_material_controller.js";

const MAX_VERTEX_SAMPLES = 120_000;
const DOMINANT_LAYER_WARNING_RATIO = 0.78;
const FALLBACK_WARNING_RATIO = 0.35;
const COARSE_PERIOD_WARNING_M = 5;
const EXTREME_PERIOD_WARNING_M = 12;

const EXTERNAL_LAYER_FALLBACK: Record<string, number> = {
  natural: 0,
  "grass-top": 0,
  dirt: 4,
  rock: 1,
  sand: 2,
  water: 2,
  snow: 3,
  lava: 1,
  "meadows-ground": 0,
  "forest-floor": 5,
  "swamp-muck": 7,
  "mountain-scree": 1,
  "plains-grass": 0,
  "coast-sand": 2,
  "ocean-floor": 7,
};

const CONTENT_SLOT_SELECTED_ID_HINTS: Record<string, readonly string[]> = {
  natural: ["grass", "generated:grass"],
  "grass-top": ["grass", "generated:grass"],
  dirt: ["dirt", "ground-054", "generated:dirt"],
  rock: ["rock", "ground-048", "generated:rock"],
  sand: ["sand", "generated:sand"],
  water: ["sand", "generated:sand"],
  snow: ["snow", "generated:snow"],
  lava: ["rock", "generated:rock"],
  "meadows-ground": ["meadows-ground", "generated:meadows-ground", "meadows ground", "grass", "generated:grass"],
  "forest-floor": ["forest-floor", "generated:forest-floor", "forest floor", "moss", "generated:moss", "grass", "generated:grass"],
  "swamp-muck": ["swamp-muck", "generated:swamp-muck", "swamp muck", "wet_soil", "generated:wet_soil", "dirt", "generated:dirt"],
  "mountain-scree": ["mountain-scree", "generated:mountain-scree", "mountain scree", "rock", "generated:rock"],
  "plains-grass": ["plains-grass", "generated:plains-grass", "plains grass", "grass", "generated:grass"],
  "coast-sand": ["coast-sand", "generated:coast-sand", "coast sand", "sand", "generated:sand"],
  "ocean-floor": ["ocean-floor", "generated:ocean-floor", "ocean floor", "wet_soil", "generated:wet_soil", "sand", "generated:sand"],
};

export type TerrainDiagnosticSeverity = "error" | "warning" | "info";

export interface TerrainDiagnosticFinding {
  severity: TerrainDiagnosticSeverity;
  code: string;
  message: string;
}

export interface TerrainDiagnosticTextureInfo {
  width: number;
  height: number;
  depth: number;
  mipmaps: boolean;
}

export interface TerrainDiagnosticSlot {
  index: number;
  name: string;
  selectedId: string;
  baseScale: number;
  resolvedScale: number;
  repeatPeriodM: number;
  heightMin: number;
  heightMax: number;
}

export interface TerrainDiagnosticLayerSet {
  biomeId: number;
  layers: readonly [number, number, number];
  names: readonly [string, string, string];
}

export interface TerrainDiagnosticVisibleSummary {
  pageCount: number;
  vertexCount: number;
  sampledVertices: number;
  heightMin: number | null;
  heightMax: number | null;
  heightMean: number | null;
  heightSpan: number;
  worldMinX: number | null;
  worldMaxX: number | null;
  worldMinZ: number | null;
  worldMaxZ: number | null;
  biomeHistogram: Record<string, number>;
  selectedLayerHistogram: Record<string, number>;
  dominantLayer: string | null;
  dominantLayerRatio: number;
  nearestFallbackRatio: number;
}

export interface TerrainMaterialDiagnosticSnapshot {
  generatedAt: string;
  backend: "webgpu" | "webgl";
  url: string;
  isolatedNearClod: boolean;
  worldCells: number;
  material: {
    source: TerrainMaterialUiState["terrainMaterialSource"];
    texturesActive: boolean;
    albedo: boolean;
    triplanar: boolean;
    normalMap: boolean;
    proceduralMicroNormals: boolean;
    textureScale: number;
    blendMode: string;
    blendWidth: number;
    debugMode: string;
    biomeSplat: boolean;
    painted: boolean;
    arraySampling: string;
    bakedMacroTint: boolean;
  };
  textures: {
    albedo: TerrainDiagnosticTextureInfo | null;
    normal: TerrainDiagnosticTextureInfo | null;
    slotCount: number;
  };
  slots: TerrainDiagnosticSlot[];
  biomeLayerSets: TerrainDiagnosticLayerSet[];
  visible: TerrainDiagnosticVisibleSummary;
  findings: TerrainDiagnosticFinding[];
}

export interface TerrainMaterialDiagnosticInput {
  backend: "webgpu" | "webgl";
  worldCells: number;
  url: string;
  state: TerrainMaterialUiState;
  slots: readonly DiagnosticRuntimeSlot[];
  options: TerrainTextureApplyOptions;
  views: Iterable<TerrainMaterialView>;
  texturesActive: boolean;
}

interface DiagnosticRuntimeSlot {
  scale: number;
  heightMin: number;
  heightMax: number;
  name?: string;
  selectedId?: string;
}

interface LayerSelection {
  layer: number;
  usedNearestFallback: boolean;
}

declare global {
  interface Window {
    __drusnielTerrainMaterialDiagnostics?: {
      snapshot(): TerrainMaterialDiagnosticSnapshot;
    };
  }
}

export function installTerrainMaterialDiagnostics(
  snapshot: () => TerrainMaterialDiagnosticSnapshot,
): void {
  if (typeof window === "undefined") return;
  window.__drusnielTerrainMaterialDiagnostics = { snapshot };
}

export function createTerrainMaterialDiagnosticSnapshot(
  input: TerrainMaterialDiagnosticInput,
): TerrainMaterialDiagnosticSnapshot {
  const procedural = input.state.terrainMaterialSource === "procedural";
  const slots = input.slots.map((slot, index): TerrainDiagnosticSlot => {
    const resolvedScale = resolveTerrainTextureScale(slot.scale, input.state.textureScale, procedural);
    return {
      index,
      name: slot.name ?? `layer-${index}`,
      selectedId: slot.selectedId ?? "unknown",
      baseScale: finiteOr(slot.scale, 0),
      resolvedScale,
      repeatPeriodM: resolvedScale > 0 ? 1 / resolvedScale : Number.POSITIVE_INFINITY,
      heightMin: finiteOr(slot.heightMin, 0),
      heightMax: finiteOr(slot.heightMax, 0),
    };
  });
  const biomeLayerSets = buildDiagnosticBiomeLayerSets(input.slots).map((layers, biomeId) => ({
    biomeId,
    layers,
    names: layers.map((layer) => slots[layer]?.name ?? `layer-${layer}`) as [string, string, string],
  }));
  const visible = summarizeVisibleTerrain(input.views, slots, biomeLayerSets, input.state.textureBlendWidth);
  const url = new URL(input.url, "http://localhost/");
  const isolatedNearClod = url.searchParams.get("farShell") !== "1"
    && url.searchParams.get("farClipmap") !== "1";
  const albedoInfo = textureInfo(input.options.albedoArray ?? null);
  const normalInfo = textureInfo(input.options.normalArray ?? null);

  const snapshot: TerrainMaterialDiagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    backend: input.backend,
    url: input.url,
    isolatedNearClod,
    worldCells: input.worldCells,
    material: {
      source: input.state.terrainMaterialSource,
      texturesActive: input.texturesActive,
      albedo: input.state.albedo,
      triplanar: input.state.triplanar,
      normalMap: input.state.normalMap,
      proceduralMicroNormals: input.state.proceduralMicroNormals,
      textureScale: input.state.textureScale,
      blendMode: input.state.textureBlendMode,
      blendWidth: input.state.textureBlendWidth,
      debugMode: input.state.proceduralDebugMode,
      biomeSplat: input.options.biomeSplat === true,
      painted: input.options.painted === true,
      arraySampling: input.options.arraySampling ?? "triplanar",
      bakedMacroTint: input.options.bakedMacroTint != null,
    },
    textures: {
      albedo: albedoInfo,
      normal: normalInfo,
      slotCount: slots.length,
    },
    slots,
    biomeLayerSets,
    visible,
    findings: [],
  };
  snapshot.findings = diagnoseSnapshot(snapshot);
  return snapshot;
}

export function selectTerrainDiagnosticLayer(
  height: number,
  layers: readonly [number, number, number],
  slots: readonly Pick<TerrainDiagnosticSlot, "heightMin" | "heightMax">[],
  blendWidth: number,
): LayerSelection {
  const safeBlend = Math.max(0, finiteOr(blendWidth, 0));
  const weights = layers.map((layer) => {
    const slot = slots[layer];
    if (!slot) return 0;
    return heightBandWeight(slot.heightMin, slot.heightMax, height, safeBlend);
  });
  const sum = weights[0] + weights[1] + weights[2];
  if (sum > 0.0001) {
    let best = 0;
    if (weights[1] > weights[best]) best = 1;
    if (weights[2] > weights[best]) best = 2;
    return { layer: layers[best], usedNearestFallback: false };
  }

  let nearestLayer = layers[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const layer of layers) {
    const slot = slots[layer];
    if (!slot) continue;
    const center = (slot.heightMin + slot.heightMax) * 0.5;
    const distance = Math.abs(height - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLayer = layer;
    }
  }
  return { layer: nearestLayer, usedNearestFallback: true };
}

function summarizeVisibleTerrain(
  views: Iterable<TerrainMaterialView>,
  slots: readonly TerrainDiagnosticSlot[],
  layerSets: readonly TerrainDiagnosticLayerSet[],
  blendWidth: number,
): TerrainDiagnosticVisibleSummary {
  const visibleViews = [...views].filter((view) => view.mesh?.visible !== false);
  const vertexCount = visibleViews.reduce(
    (sum, view) => sum + (view.mesh?.geometry.getAttribute("position")?.count ?? 0),
    0,
  );
  const stride = Math.max(1, Math.ceil(vertexCount / MAX_VERTEX_SAMPLES));
  const biomeHistogram = new Map<number, number>();
  const layerHistogram = new Map<number, number>();
  const point = new THREE.Vector3();
  let sampledVertices = 0;
  let fallbackCount = 0;
  let heightSum = 0;
  let heightMin = Number.POSITIVE_INFINITY;
  let heightMax = Number.NEGATIVE_INFINITY;
  let worldMinX = Number.POSITIVE_INFINITY;
  let worldMaxX = Number.NEGATIVE_INFINITY;
  let worldMinZ = Number.POSITIVE_INFINITY;
  let worldMaxZ = Number.NEGATIVE_INFINITY;
  let globalIndex = 0;

  for (const view of visibleViews) {
    const mesh = view.mesh;
    if (!mesh) continue;
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;
    const biome = mesh.geometry.getAttribute("biomeId");
    mesh.updateWorldMatrix(true, false);
    for (let index = 0; index < position.count; index++, globalIndex++) {
      if (globalIndex % stride !== 0) continue;
      point.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld);
      const biomeId = Math.max(0, Math.round(biome?.getX(index) ?? 0));
      const layers = layerSets[biomeId]?.layers ?? layerSets[0]?.layers ?? [0, 0, 0];
      const selected = selectTerrainDiagnosticLayer(point.y, layers, slots, blendWidth);
      biomeHistogram.set(biomeId, (biomeHistogram.get(biomeId) ?? 0) + 1);
      layerHistogram.set(selected.layer, (layerHistogram.get(selected.layer) ?? 0) + 1);
      if (selected.usedNearestFallback) fallbackCount++;
      sampledVertices++;
      heightSum += point.y;
      heightMin = Math.min(heightMin, point.y);
      heightMax = Math.max(heightMax, point.y);
      worldMinX = Math.min(worldMinX, point.x);
      worldMaxX = Math.max(worldMaxX, point.x);
      worldMinZ = Math.min(worldMinZ, point.z);
      worldMaxZ = Math.max(worldMaxZ, point.z);
    }
  }

  const sortedLayers = [...layerHistogram.entries()].sort((a, b) => b[1] - a[1]);
  const dominantLayerIndex = sortedLayers[0]?.[0];
  const dominantLayerCount = sortedLayers[0]?.[1] ?? 0;
  return {
    pageCount: visibleViews.length,
    vertexCount,
    sampledVertices,
    heightMin: sampledVertices > 0 ? heightMin : null,
    heightMax: sampledVertices > 0 ? heightMax : null,
    heightMean: sampledVertices > 0 ? heightSum / sampledVertices : null,
    heightSpan: sampledVertices > 0 ? heightMax - heightMin : 0,
    worldMinX: sampledVertices > 0 ? worldMinX : null,
    worldMaxX: sampledVertices > 0 ? worldMaxX : null,
    worldMinZ: sampledVertices > 0 ? worldMinZ : null,
    worldMaxZ: sampledVertices > 0 ? worldMaxZ : null,
    biomeHistogram: Object.fromEntries([...biomeHistogram.entries()].map(([key, value]) => [String(key), value])),
    selectedLayerHistogram: Object.fromEntries(
      sortedLayers.map(([layer, count]) => [slots[layer]?.name ?? `layer-${layer}`, count]),
    ),
    dominantLayer: dominantLayerIndex === undefined ? null : slots[dominantLayerIndex]?.name ?? `layer-${dominantLayerIndex}`,
    dominantLayerRatio: sampledVertices > 0 ? dominantLayerCount / sampledVertices : 0,
    nearestFallbackRatio: sampledVertices > 0 ? fallbackCount / sampledVertices : 0,
  };
}

function diagnoseSnapshot(snapshot: TerrainMaterialDiagnosticSnapshot): TerrainDiagnosticFinding[] {
  const findings: TerrainDiagnosticFinding[] = [];
  const add = (severity: TerrainDiagnosticSeverity, code: string, message: string): void => {
    findings.push({ severity, code, message });
  };

  if (!snapshot.isolatedNearClod) {
    add("warning", "FAR_PATH_ACTIVE", "Far shell or far clipmap is active; visual conclusions would mix a separate renderer path.");
  }
  if (!snapshot.material.texturesActive) {
    add("error", "TEXTURES_INACTIVE", "Terrain textures are inactive in the near CLOD material.");
  }
  if (snapshot.material.source !== "procedural") {
    add("warning", "NON_PROCEDURAL_SOURCE", `Terrain source is ${snapshot.material.source}, not procedural.`);
  }
  if (snapshot.textures.slotCount === 0) {
    add("error", "NO_TEXTURE_SLOTS", "The near CLOD material has no active terrain texture slots.");
  }
  if (!snapshot.textures.albedo) {
    add("error", "NO_ALBEDO_ARRAY", "The near CLOD material has no albedo texture array.");
  } else if (snapshot.textures.albedo.depth !== snapshot.textures.slotCount) {
    add(
      "error",
      "ALBEDO_DEPTH_MISMATCH",
      `Albedo array depth ${snapshot.textures.albedo.depth} does not match ${snapshot.textures.slotCount} slots.`,
    );
  }
  if (snapshot.visible.sampledVertices === 0) {
    add("error", "NO_VISIBLE_CLOD_SAMPLES", "No visible CLOD terrain vertices were available for diagnosis.");
  }

  const uniqueBiomeIds = Object.keys(snapshot.visible.biomeHistogram).length;
  if (uniqueBiomeIds <= 1 && snapshot.visible.sampledVertices > 1_000) {
    add(
      "warning",
      "UNIFORM_BIOME_ATTRIBUTE",
      "Visible near CLOD pages contain only one biome ID. This may be a valid single-biome view, but it can also indicate a collapsed biome attribute.",
    );
  }

  const uniqueLayerSets = new Set(snapshot.biomeLayerSets.map((set) => set.layers.join(","))).size;
  if (snapshot.material.biomeSplat && uniqueLayerSets <= 2 && snapshot.biomeLayerSets.length > 2) {
    add(
      "warning",
      "COLLAPSED_BIOME_LAYER_SETS",
      `${snapshot.biomeLayerSets.length} biome IDs resolve to only ${uniqueLayerSets} distinct layer sets.`,
    );
  }

  if (
    snapshot.visible.dominantLayerRatio >= DOMINANT_LAYER_WARNING_RATIO
    && snapshot.visible.heightSpan >= 20
  ) {
    add(
      "warning",
      "DOMINANT_LAYER_COLLAPSE",
      `${snapshot.visible.dominantLayer ?? "one layer"} is selected for ${(snapshot.visible.dominantLayerRatio * 100).toFixed(1)}% of sampled vertices across ${snapshot.visible.heightSpan.toFixed(1)} m of height.`,
    );
  }
  if (
    snapshot.visible.dominantLayer
    && isGreenGroundLayer(snapshot.visible.dominantLayer)
    && snapshot.visible.dominantLayerRatio >= 0.65
  ) {
    add(
      "warning",
      "GREEN_LAYER_DOMINANCE",
      `${snapshot.visible.dominantLayer} dominates ${(snapshot.visible.dominantLayerRatio * 100).toFixed(1)}% of near CLOD samples.`,
    );
  }
  if (snapshot.visible.nearestFallbackRatio >= FALLBACK_WARNING_RATIO) {
    add(
      "warning",
      "HEIGHT_BAND_GAPS",
      `${(snapshot.visible.nearestFallbackRatio * 100).toFixed(1)}% of samples fall outside all three biome height bands and use nearest-layer fallback.`,
    );
  }

  const finitePeriods = snapshot.slots.map((slot) => slot.repeatPeriodM).filter(Number.isFinite).sort((a, b) => a - b);
  const medianPeriod = finitePeriods[Math.floor(finitePeriods.length / 2)] ?? 0;
  const maxPeriod = finitePeriods.at(-1) ?? 0;
  if (medianPeriod >= COARSE_PERIOD_WARNING_M) {
    add(
      "warning",
      "COARSE_TEXTURE_SCALE",
      `Median terrain texture repeat period is ${medianPeriod.toFixed(2)} m; detail can read as flat at player distance.`,
    );
  }
  if (maxPeriod >= EXTREME_PERIOD_WARNING_M) {
    add(
      "warning",
      "EXTREME_TEXTURE_SCALE",
      `At least one terrain layer repeats every ${maxPeriod.toFixed(2)} m.`,
    );
  }

  if (findings.length === 0) {
    add("info", "NO_CONFIG_FAULT_FOUND", "No material configuration or visible-layer collapse was detected in the isolated near CLOD path.");
  }
  return findings;
}

function buildDiagnosticBiomeLayerSets(
  slots: readonly DiagnosticRuntimeSlot[],
): Array<readonly [number, number, number]> {
  try {
    const registry = loadContentRegistry();
    return EXPECTED_BIOME_REGION_IDS.map((biomeId) => {
      const slotSet = getBiomeTextureSlotSet(registry, biomeId);
      const layers = (slotSet?.slots ?? [])
        .map((slot) => resolveContentTextureSlotLayer(slot.id, slots))
        .filter((layer) => Number.isInteger(layer) && layer >= 0);
      return normalizeLayerSet(layers, slots.length);
    });
  } catch {
    const fallback = normalizeLayerSet([0, 1, 2], slots.length);
    return EXPECTED_BIOME_REGION_IDS.map(() => fallback);
  }
}

function resolveContentTextureSlotLayer(
  contentSlotId: string,
  slots: readonly DiagnosticRuntimeSlot[],
): number {
  const hints = CONTENT_SLOT_SELECTED_ID_HINTS[contentSlotId] ?? [];
  for (const hint of hints) {
    const found = slots.findIndex((slot) => {
      const selected = slot.selectedId?.toLowerCase() ?? "";
      const name = slot.name?.toLowerCase() ?? "";
      return selected.includes(hint) || name.includes(hint.replace("generated:", ""));
    });
    if (found >= 0) return found;
  }
  return EXTERNAL_LAYER_FALLBACK[contentSlotId] ?? 0;
}

function normalizeLayerSet(
  layers: readonly number[],
  layerCount: number,
): readonly [number, number, number] {
  const maxLayer = Math.max(0, layerCount - 1);
  const clampLayer = (layer: number): number => Math.max(0, Math.min(maxLayer, Math.round(layer)));
  const first = clampLayer(layers[0] ?? 0);
  const second = clampLayer(layers[1] ?? first);
  const third = clampLayer(layers[2] ?? second);
  return [first, second, third];
}

function heightBandWeight(
  heightMin: number,
  heightMax: number,
  height: number,
  blendWidth: number,
): number {
  return smoothstep(heightMin - blendWidth, heightMin + blendWidth, height)
    * (1 - smoothstep(heightMax - blendWidth, heightMax + blendWidth, height));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function textureInfo(texture: THREE.Texture | null): TerrainDiagnosticTextureInfo | null {
  if (!texture) return null;
  const image = texture.image as { width?: number; height?: number; depth?: number } | undefined;
  return {
    width: Math.max(0, Number(image?.width ?? 0)),
    height: Math.max(0, Number(image?.height ?? 0)),
    depth: Math.max(0, Number(image?.depth ?? 1)),
    mipmaps: texture.generateMipmaps,
  };
}

function isGreenGroundLayer(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("grass")
    || normalized.includes("meadow")
    || normalized.includes("moss")
    || normalized.includes("forest");
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
