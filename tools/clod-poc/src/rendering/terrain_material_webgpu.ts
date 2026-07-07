// WebGPU implementation of TerrainMaterialHandle, wrapping the TSL terrain NodeMaterial.
// Texture/triplanar changes rebuild the node graph because texture-array slots are baked into
// the TSL graph; all owning meshes are notified so their .material reference is swapped.

import * as THREE from "three";
import {
  createTerrainNodeMaterial,
  DEFAULT_TERRAIN_COLOR_ADJUST,
  DEFAULT_TERRAIN_NODE_LIGHTING,
  type BiomeLayerSet,
  type TerrainColorAdjust,
  type TerrainNodeLighting,
  type TerrainNodeMaterialHandle,
  type TerrainNodeTextures,
} from "../gpu/terrain_node_material.js";
import type {
  TerrainDebugState,
  TerrainMaterialHandle,
  TerrainTextureApplyOptions,
} from "./terrain_material.js";
import type { TerrainTextureSlotUniform } from "../material/material.js";
import { EXPECTED_BIOME_REGION_IDS, getBiomeTextureSlotSet, loadContentRegistry } from "../content/index.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "./material_churn/material_churn_diagnostics.js";

type MaterialChangedCallback = (material: THREE.Material) => void;
type RuntimeTextureSlot = TerrainTextureSlotUniform & { selectedId?: string; name?: string };

const EXTERNAL_LAYER_FALLBACK: Record<string, number> = {
  "natural": 0,
  "grass-top": 0,
  "dirt": 4,
  "rock": 1,
  "sand": 2,
  "water": 2,
  "snow": 3,
  "lava": 1,
  "meadows-ground": 0,
  "forest-floor": 5,
  "swamp-muck": 7,
  "mountain-scree": 1,
  "plains-grass": 0,
  "coast-sand": 2,
  "ocean-floor": 7,
};

const CONTENT_SLOT_SELECTED_ID_HINTS: Record<string, readonly string[]> = {
  "natural": ["grass", "generated:grass"],
  "grass-top": ["grass", "generated:grass"],
  "dirt": ["dirt", "ground-054", "generated:dirt"],
  "rock": ["rock", "ground-048", "generated:rock"],
  "sand": ["sand", "generated:sand"],
  "water": ["sand", "generated:sand"],
  "snow": ["snow", "generated:snow"],
  "lava": ["rock", "generated:rock"],
  "meadows-ground": ["meadows-ground", "generated:meadows-ground", "meadows ground", "grass", "generated:grass"],
  "forest-floor": ["forest-floor", "generated:forest-floor", "forest floor", "moss", "generated:moss", "grass", "generated:grass"],
  "swamp-muck": ["swamp-muck", "generated:swamp-muck", "swamp muck", "wet_soil", "generated:wet_soil", "dirt", "generated:dirt"],
  "mountain-scree": ["mountain-scree", "generated:mountain-scree", "mountain scree", "rock", "generated:rock"],
  "plains-grass": ["plains-grass", "generated:plains-grass", "plains grass", "grass", "generated:grass"],
  "coast-sand": ["coast-sand", "generated:coast-sand", "coast sand", "sand", "generated:sand"],
  "ocean-floor": ["ocean-floor", "generated:ocean-floor", "ocean floor", "wet_soil", "generated:wet_soil", "sand", "generated:sand"],
};

export function createWebGpuTerrainMaterial(color: number): TerrainMaterialHandle {
  let lighting: TerrainNodeLighting = {
    ...DEFAULT_TERRAIN_NODE_LIGHTING,
    lightDir: DEFAULT_TERRAIN_NODE_LIGHTING.lightDir.clone(),
    sunColor: DEFAULT_TERRAIN_NODE_LIGHTING.sunColor.clone(),
    skyLight: DEFAULT_TERRAIN_NODE_LIGHTING.skyLight.clone(),
    groundLight: DEFAULT_TERRAIN_NODE_LIGHTING.groundLight.clone(),
    baseColor: new THREE.Color(color),
  };
  let adjust: TerrainColorAdjust = { ...DEFAULT_TERRAIN_COLOR_ADJUST };
  let textures: TerrainNodeTextures | null = null;
  let debug: TerrainDebugState = { normalColor: false, normalDivergence: false, divergenceGain: 1 };
  let side: THREE.Side = THREE.DoubleSide;
  let wireframe = false;
  let fade = 1;
  let fadeIn = true;
  let dither = false;
  let rootMorphInfluence = 0;
  let textureSignature = "";
  let warnedNormalDivergence = false;
  const callbacks: MaterialChangedCallback[] = [];
  let node: TerrainNodeMaterialHandle = createNode("initial");

  const rebuild = (reason: string): void => {
    const previous = node.material;
    node = createNode(reason);
    materialChurnDiagnostics.trackMaterialAssigned("webgpu-terrain-handle", previous, node.material, reason);
    previous.dispose();
    for (const callback of callbacks) callback(node.material);
  };

  function createNode(reason: string): TerrainNodeMaterialHandle {
    const next = createTerrainNodeMaterial({ lighting, adjust, textures });
    next.material.side = side;
    next.material.wireframe = wireframe;
    next.setFade(fade, fadeIn, dither);
    next.setRootMorph(rootMorphInfluence);
    next.setDebug(debug);
    materialChurnDiagnostics.trackNewMaterial(next.material, `webgpu-terrain-node:${reason}`);
    return next;
  }

  return {
    get material() {
      return node.material;
    },
    onMaterialChanged(callback) {
      callbacks.push(callback);
      return () => {
        const i = callbacks.indexOf(callback);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    setBaseColor(c) {
      lighting = { ...lighting, baseColor: new THREE.Color(c) };
      node.setLighting({ baseColor: lighting.baseColor });
    },
    setColorAdjust(next) {
      adjust = { ...next };
      node.setColorAdjust(adjust);
    },
    setLighting(next) {
      lighting = {
        ...lighting,
        lightDir: next.sunDirection.clone(),
        sunColor: next.sunColor.clone(),
        skyLight: next.skyLight.clone(),
        groundLight: next.groundLight.clone(),
      };
      node.setLighting({
        lightDir: lighting.lightDir,
        sunColor: lighting.sunColor,
        skyLight: lighting.skyLight,
        groundLight: lighting.groundLight,
      });
    },
    setTextures(slots, options) {
      const nextSignature = textureOptionsSignature(slots, options);
      lighting = { ...lighting, roughness: options.roughness };
      node.setRoughness(options.roughness);
      node.setTextureParams({
        blendWidth: options.blendWidth,
        normalIntensity: options.normalIntensity,
      });
      if (nextSignature === textureSignature) return;
      materialChurnDiagnostics.trackPipelineSensitiveMutation(
        node.material,
        "textureSignature",
        textureSignature,
        nextSignature,
        "webgpu-terrain-textures",
      );
      textureSignature = nextSignature;
      textures = toNodeTextures(slots, options);
      rebuild("webgpu-terrain-textures");
    },
    setDebug(next) {
      if (next.normalDivergence && !warnedNormalDivergence) {
        warnedNormalDivergence = true;
        console.warn("[webgpu terrain] normal-divergence debug is not supported by the current TSL build");
      }
      debug = { ...next };
      node.setDebug(debug);
    },
    setTriplanar(on) {
      if (!textures || textures.triplanar === on) return;
      materialChurnDiagnostics.trackPipelineSensitiveMutation(
        node.material,
        "triplanar",
        textures.triplanar,
        on,
        "webgpu-terrain-triplanar",
      );
      textures = { ...textures, triplanar: on };
      textureSignature = `${textureSignature}|triplanar:${on}`;
      rebuild("webgpu-terrain-triplanar");
    },
    setSide(next) {
      side = next;
      if (setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, node.material, "side", next, "webgpu-terrain-side")) {
        setMaterialNeedsUpdate(materialChurnDiagnostics, node.material, "webgpu-terrain-side");
      }
    },
    setWireframe(on) {
      wireframe = on;
      setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, node.material, "wireframe", on, "webgpu-terrain-wireframe");
    },
    setFade(nextFade, nextFadeIn, nextDither) {
      fade = nextFade;
      fadeIn = nextFadeIn;
      dither = nextDither;
      node.setFade(fade, fadeIn, dither);
    },
    setRootMorph(influence) {
      rootMorphInfluence = influence;
      node.setRootMorph(rootMorphInfluence);
    },
    setTier(tier) {
      node.setTier(tier);
    },
  };
}

function textureOptionsSignature(
  slots: readonly TerrainTextureSlotUniform[],
  options: TerrainTextureApplyOptions,
): string {
  if (!options.enabled || !options.albedoArray || slots.length === 0) return "off";
  const procedural = options.procedural;
  const normalMapMask = procedural?.normalMapMask
    ? Array.from(procedural.normalMapMask).join(",")
    : slots.map((slot) => (slot.normalTexture ? 1 : 0)).join(",");
  const biomeLayerSets = options.biomeSplat === true
    ? buildBiomeLayerSets(slots).map((set) => set.join(",")).join(";")
    : "";
  return [
    "on",
    options.albedoArray.uuid,
    options.normalMap ? options.normalArray?.uuid ?? "_" : "_",
    options.triplanar ? 1 : 0,
    options.normalMap ? 1 : 0,
    options.textureScale,
    options.blendBands ? 1 : 0,
    options.arraySampling ?? "triplanar",
    options.painted ? 1 : 0,
    procedural?.enabled ? 1 : 0,
    procedural?.noiseA?.uuid ?? "_",
    procedural?.noiseB?.uuid ?? "_",
    procedural?.debugMode ?? 0,
    procedural?.microFadeStart ?? 45,
    procedural?.microFadeEnd ?? 85,
    procedural?.lodBias ?? 0,
    normalMapMask,
    biomeLayerSets,
    options.bakedMacroTint ? options.bakedMacroTint.uuid : "_",
    options.riverWetnessMask ? options.riverWetnessMask.uuid : "_",
    options.worldSize ?? "_",
    slots.map((slot) => [
      slot.texture?.uuid ?? "_",
      slot.normalTexture?.uuid ?? "_",
      slot.scale,
      slot.heightMin,
      slot.heightMax,
      (slot as RuntimeTextureSlot).selectedId ?? "_",
    ].join(":")).join(";"),
  ].join("|");
}

function toNodeTextures(
  slots: readonly TerrainTextureSlotUniform[],
  options: TerrainTextureApplyOptions,
): TerrainNodeTextures | null {
  if (!options.enabled || !options.albedoArray || slots.length === 0) return null;
  const normalMapMask = options.procedural?.normalMapMask
    ?? slots.map((slot) => (slot.normalTexture ? 1 : 0));
  return {
    albedoArray: options.albedoArray,
    normalArray: options.normalMap ? options.normalArray : null,
    slots: slots.map((slot) => ({
      scale: slot.scale * options.textureScale,
      heightMin: slot.heightMin,
      heightMax: slot.heightMax,
    })),
    blendBands: options.blendBands,
    blendWidth: options.blendWidth,
    normalIntensity: options.normalIntensity,
    triplanar: options.triplanar,
    arraySampling: options.arraySampling ?? "triplanar",
    normalMapMask,
    painted: options.painted ?? false,
    debugMode: options.procedural?.debugMode ?? 0,
    biomeLayerSets: options.biomeSplat === true ? buildBiomeLayerSets(slots) : undefined,
    procedural: options.procedural?.enabled && options.procedural.noiseA && options.procedural.noiseB
      ? {
          noiseA: options.procedural.noiseA,
          noiseB: options.procedural.noiseB,
          microFadeStart: options.procedural.microFadeStart,
          microFadeEnd: options.procedural.microFadeEnd,
          lodBias: options.procedural.lodBias,
        }
      : null,
    bakedMacroTint: options.bakedMacroTint,
    riverWetnessMask: options.riverWetnessMask,
    worldSize: options.worldSize,
  };
}

function buildBiomeLayerSets(slots: readonly TerrainTextureSlotUniform[]): BiomeLayerSet[] {
  const registry = loadContentRegistry();
  return EXPECTED_BIOME_REGION_IDS.map((biomeId) => {
    const slotSet = getBiomeTextureSlotSet(registry, biomeId);
    const layers = (slotSet?.slots ?? [])
      .map((slot) => resolveContentTextureSlotLayer(slot.id, slots))
      .filter((layer) => Number.isInteger(layer) && layer >= 0);
    return normalizeLayerSet(layers, slots.length);
  });
}

function normalizeLayerSet(layers: readonly number[], layerCount: number): BiomeLayerSet {
  const maxLayer = Math.max(0, layerCount - 1);
  const clampLayer = (layer: number): number => Math.max(0, Math.min(maxLayer, Math.round(layer)));
  const first = clampLayer(layers[0] ?? 0);
  const second = clampLayer(layers[1] ?? first);
  const third = clampLayer(layers[2] ?? second);
  return [first, second, third];
}

function resolveContentTextureSlotLayer(contentSlotId: string, slots: readonly TerrainTextureSlotUniform[]): number {
  const runtimeSlots = slots as readonly RuntimeTextureSlot[];
  const hints = CONTENT_SLOT_SELECTED_ID_HINTS[contentSlotId] ?? [];
  for (const hint of hints) {
    const found = runtimeSlots.findIndex((slot) => {
      const selected = slot.selectedId?.toLowerCase() ?? "";
      const name = slot.name?.toLowerCase() ?? "";
      return selected.includes(hint) || name.includes(hint.replace("generated:", ""));
    });
    if (found >= 0) return found;
  }
  return EXTERNAL_LAYER_FALLBACK[contentSlotId] ?? 0;
}
