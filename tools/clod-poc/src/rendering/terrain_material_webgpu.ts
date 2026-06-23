// WebGPU implementation of TerrainMaterialHandle, wrapping the TSL terrain NodeMaterial.
// Texture/triplanar changes rebuild the node graph because texture-array slots are baked into
// the TSL graph; all owning meshes are notified so their .material reference is swapped.

import * as THREE from "three";
import {
  createTerrainNodeMaterial,
  DEFAULT_TERRAIN_COLOR_ADJUST,
  DEFAULT_TERRAIN_NODE_LIGHTING,
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
import type { TerrainTextureSlotUniform } from "../material.js";

type MaterialChangedCallback = (material: THREE.Material) => void;

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
  let textureSignature = "";
  let warnedNormalDivergence = false;
  const callbacks: MaterialChangedCallback[] = [];
  let node: TerrainNodeMaterialHandle = createNode();

  const rebuild = (): void => {
    const previous = node.material;
    node = createNode();
    previous.dispose();
    for (const callback of callbacks) callback(node.material);
  };

  function createNode(): TerrainNodeMaterialHandle {
    const next = createTerrainNodeMaterial({ lighting, adjust, textures });
    next.material.side = side;
    next.material.wireframe = wireframe;
    next.setFade(fade, fadeIn, dither);
    next.setDebug(debug);
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
      textureSignature = nextSignature;
      textures = toNodeTextures(slots, options);
      rebuild();
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
      textures = { ...textures, triplanar: on };
      textureSignature = `${textureSignature}|triplanar:${on}`;
      rebuild();
    },
    setSide(next) {
      side = next;
      node.material.side = next;
      node.material.needsUpdate = true;
    },
    setWireframe(on) {
      wireframe = on;
      node.material.wireframe = on;
    },
    setFade(nextFade, nextFadeIn, nextDither) {
      fade = nextFade;
      fadeIn = nextFadeIn;
      dither = nextDither;
      node.setFade(fade, fadeIn, dither);
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
  if (!options.enabled || !options.albedoArray || slots.length === 0) {
    return "off";
  }
  const procedural = options.procedural;
  const normalMapMask = procedural?.normalMapMask
    ? Array.from(procedural.normalMapMask).join(",")
    : slots.map((slot) => (slot.normalTexture ? 1 : 0)).join(",");
  return [
    "on",
    options.albedoArray.uuid,
    options.normalMap ? options.normalArray?.uuid ?? "_" : "_",
    options.triplanar ? 1 : 0,
    options.normalMap ? 1 : 0,
    options.textureScale,
    options.blendBands ? 1 : 0,
    procedural?.enabled ? 1 : 0,
    procedural?.noiseA?.uuid ?? "_",
    procedural?.noiseB?.uuid ?? "_",
    procedural?.debugMode ?? 0,
    procedural?.microFadeStart ?? 45,
    procedural?.microFadeEnd ?? 85,
    procedural?.lodBias ?? 0,
    normalMapMask,
    // LV-6: baked macro tint + world size (change triggers rebuild).
    (options as Record<string, unknown>).bakedMacroTint
      ? ((options as Record<string, unknown>).bakedMacroTint as THREE.Texture).uuid
      : "_",
    (options as Record<string, unknown>).worldSize ?? "_",
    slots.map((slot) => [
      slot.texture?.uuid ?? "_",
      slot.normalTexture?.uuid ?? "_",
      slot.scale,
      slot.heightMin,
      slot.heightMax,
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
    normalMapMask,
    debugMode: options.procedural?.debugMode ?? 0,
    procedural: options.procedural?.enabled && options.procedural.noiseA && options.procedural.noiseB
      ? {
          noiseA: options.procedural.noiseA,
          noiseB: options.procedural.noiseB,
          microFadeStart: options.procedural.microFadeStart,
          microFadeEnd: options.procedural.microFadeEnd,
          lodBias: options.procedural.lodBias,
        }
      : null,
    // LV-6: baked macro tint + world size, passed through from main.ts options.
    bakedMacroTint: (options as Record<string, unknown>).bakedMacroTint as THREE.Texture | null | undefined,
    worldSize: (options as Record<string, unknown>).worldSize as number | undefined,
  };
}
