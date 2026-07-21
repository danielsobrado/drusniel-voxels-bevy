import * as THREE from "three";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  screenCoordinate,
  smoothstep,
  storage,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  forestLightingDebugModeValue,
  type ForestLightingMaterialState,
} from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import { TREE_FOLIAGE_ATLAS_COLUMNS, TREE_FOLIAGE_ATLAS_ROWS } from "./tree_alpha_mask.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { decorateTreeNodeForestLighting } from "./tree_node_forest_lighting.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import { TREE_RING_INSTANCE_VEC4S } from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface NodeMaterialLike extends THREE.Material {
  colorNode?: TslNode;
  maskNode?: TslNode;
  positionNode?: TslNode;
}

export interface TreeMaterialParityOptions {
  foliageAtlas: TreeFoliageAtlas;
  ring?: {
    settings: TreeSettings;
    buffers: TreeRingInstanceBuffers;
    forestLighting: boolean;
  };
}

const CARD_ALPHA_THRESHOLD = 0.32;
const CARD_EDGE_NEAR_M = 35;
const CARD_EDGE_FAR_M = 70;
const CAMERA_FADE_START_M = 0.85;
const CAMERA_FADE_END_M = 2.6;
const RING_FOREST_DARKEN_MAX = 0.72;
const RING_FOREST_FOG_MAX = 0.35;
const RING_FOREST_SHAFT_HINT = 0.05;
const RING_FOREST_FOG_COLOR = new THREE.Vector3(0.72, 0.78, 0.81);

export function decorateTreeMaterialHandle(
  handle: TreeMaterialHandle,
  options: TreeMaterialParityOptions,
): TreeMaterialHandle {
  const visibility = createTreeVisibilityNodes(options.foliageAtlas);
  const materials = [handle.regularMaterial, ...Object.values(handle.debugMaterials)]
    .filter((material, index, all) => all.indexOf(material) === index) as NodeMaterialLike[];

  for (const material of materials) {
    const previousMask = material.maskNode as TslNode | undefined;
    material.maskNode = previousMask ? previousMask.and(visibility.keep) : visibility.keep;
  }

  const regular = handle.regularMaterial as NodeMaterialLike;
  if (regular.colorNode) {
    regular.colorNode = mix(
      regular.colorNode,
      regular.colorNode.mul(visibility.cardShade),
      visibility.cardTag,
    );
  }

  const forest = options.ring?.forestLighting
    ? createRingForestLighting(options.ring.buffers, regular)
    : null;
  const originalPrepass = handle.prepassNodesFor?.bind(handle);
  const originalUpdateForestLighting = handle.updateForestLighting?.bind(handle);
  const originalDispose = handle.dispose.bind(handle);

  handle.prepassNodesFor = (lod: TreeLod): PrepassNodes | undefined => {
    const base = originalPrepass?.(lod);
    if (!base) return undefined;
    const baseMask = base.maskNode as TslNode | undefined;
    return {
      ...base,
      maskNode: baseMask ? baseMask.and(visibility.keep) : visibility.keep,
    };
  };
  handle.updateForestLighting = (state: ForestLightingMaterialState | null): void => {
    originalUpdateForestLighting?.(state);
    forest?.update(state);
  };
  handle.dispose = (): void => {
    forest?.dispose();
    originalDispose();
  };
  return !options.ring && regular.colorNode
    ? decorateTreeNodeForestLighting(handle)
    : handle;
}

function createTreeVisibilityNodes(atlas: TreeFoliageAtlas): {
  cardTag: TslNode;
  cardShade: TslNode;
  keep: TslNode;
} {
  const cardTag: TslNode = clamp(attribute("treeFoliageCard", "float"), 0, 1);
  const packedTreeWind: TslNode = attribute("treeWind", "vec3");
  const speciesIndex: TslNode = clamp(
    floor(packedTreeWind.z.add(0.5)),
    0,
    TREE_FOLIAGE_ATLAS_ROWS - 1,
  );
  const localUv: TslNode = clamp(uv(), vec2(0), vec2(0.9999));
  const scaled: TslNode = localUv.mul(2);
  const tileX: TslNode = floor(scaled.x);
  const tileY: TslNode = floor(scaled.y);
  const tile: TslNode = tileX.add(tileY.mul(2));
  const within: TslNode = fract(scaled);
  const atlasUv: TslNode = vec2(
    tile.add(within.x).div(TREE_FOLIAGE_ATLAS_COLUMNS),
    speciesIndex.add(within.y).div(TREE_FOLIAGE_ATLAS_ROWS),
  );
  const sampled: TslNode = texture(atlas.texture, atlasUv);

  const cameraDistance: TslNode = positionWorld.sub(cameraPosition).length();
  const viewDirection: TslNode = normalize(cameraPosition.sub(positionWorld));
  const edgeFacing: TslNode = abs(dot(normalize(normalWorld), viewDirection));
  const edgeFade: TslNode = mix(
    smoothstep(0.06, 0.2, edgeFacing),
    float(1),
    smoothstep(CARD_EDGE_NEAR_M, CARD_EDGE_FAR_M, cameraDistance),
  );
  const coverage: TslNode = sampled.w.mul(edgeFade);
  const cardKeep: TslNode = mix(float(1), coverage, cardTag).greaterThan(CARD_ALPHA_THRESHOLD);

  const cameraFade: TslNode = smoothstep(CAMERA_FADE_START_M, CAMERA_FADE_END_M, cameraDistance);
  const cameraNoise: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  const cameraKeep: TslNode = cameraNoise.lessThan(cameraFade);

  const atlasValue: TslNode = max(max(sampled.x, sampled.y), sampled.z);
  const cardShadeValue: TslNode = mix(0.72, 1.08, clamp(atlasValue.mul(4), 0, 1));
  const cardShade: TslNode = mix(vec3(1), vec3(cardShadeValue), cardTag);
  return { cardTag, cardShade, keep: cardKeep.and(cameraKeep) };
}

function createRingForestLighting(
  buffers: TreeRingInstanceBuffers,
  material: NodeMaterialLike,
): {
  update(state: ForestLightingMaterialState | null): void;
  dispose(): void;
} {
  const neutralPackedTexture = createNeutralForestTexture("tree-ring-forest-neutral-packed");
  const neutralAuxTexture = createNeutralForestTexture("tree-ring-forest-neutral-aux");
  const enabled = uniform(0);
  const worldSize = uniform(1);
  const aoStrength = uniform(1);
  const shadowStrength = uniform(1);
  const fogStrength = uniform(0);
  const fogColor = uniform(RING_FOREST_FOG_COLOR.clone());
  const debugMode = uniform(0);

  // The ring buffer holds TREE_RING_INSTANCE_VEC4S vec4s per tree record; position_scale
  // is field 0 and already carries the jittered world position. Reading it with a stride
  // of one returned a neighbouring record's rotation/identity bits as if they were this
  // tree's cell, and because the compute assigns slots with atomicAdd that garbage moved
  // every dispatch — so each tree sampled the forest lighting at a different UV each
  // frame, which is the "light jumping / darker-lighter" flicker.
  const records: TslNode = storage(
    buffers.cell,
    "vec4",
    buffers.capacity * TREE_RING_INSTANCE_VEC4S,
  ).toReadOnly();
  const positionScale: TslNode = records.element(instanceIndex.mul(TREE_RING_INSTANCE_VEC4S));
  const worldXZ: TslNode = positionScale.xz;
  const forestUv: TslNode = clamp(worldXZ.div(worldSize), vec2(0), vec2(1));
  const packed: TslNode = texture(neutralPackedTexture, forestUv);
  const aux: TslNode = texture(neutralAuxTexture, forestUv);

  if (material.colorNode) {
    const darken: TslNode = clamp(
      packed.x.mul(aoStrength).add(packed.y.mul(shadowStrength)),
      0,
      RING_FOREST_DARKEN_MAX,
    ).mul(enabled);
    const fog: TslNode = clamp(packed.z.mul(fogStrength).mul(enabled), 0, RING_FOREST_FOG_MAX);
    const lit: TslNode = mix(
      material.colorNode.mul(float(1).sub(darken)),
      fogColor,
      fog,
    ).add(vec3(packed.w.mul(RING_FOREST_SHAFT_HINT).mul(enabled)));
    const debugColor = ringForestDebugColor(debugMode, packed, aux);
    const debugActive = enabled.greaterThan(0.5).and(debugMode.greaterThan(0.5));
    material.colorNode = debugActive.select(debugColor, lit);
  }

  const reset = (): void => {
    enabled.value = 0;
    worldSize.value = 1;
    aoStrength.value = 1;
    shadowStrength.value = 1;
    fogStrength.value = 0;
    fogColor.value.copy(RING_FOREST_FOG_COLOR);
    debugMode.value = 0;
    packed.value = neutralPackedTexture;
    aux.value = neutralAuxTexture;
  };

  return {
    update(state: ForestLightingMaterialState | null): void {
      if (!state) {
        reset();
        return;
      }
      const config = state.settings;
      enabled.value = config.enabled && config.materialIntegration.treeEnabled ? 1 : 0;
      worldSize.value = Math.max(1, state.worldCells);
      aoStrength.value = config.ambientOcclusion.strength;
      shadowStrength.value = config.shadowProxy.strength;
      fogStrength.value = config.atmosphere.forestFogStrength + config.atmosphere.aerialTintStrength;
      debugMode.value = forestLightingDebugModeValue(config.materialIntegration.debugMode);
      packed.value = state.textureHandle.texture;
      aux.value = state.textureHandle.auxTexture;
    },
    dispose(): void {
      neutralPackedTexture.dispose();
      neutralAuxTexture.dispose();
    },
  };
}

function createNeutralForestTexture(name: string): THREE.DataTexture {
  const result = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  result.name = name;
  result.needsUpdate = true;
  return result;
}

function ringForestDebugColor(debugMode: TslNode, packed: TslNode, aux: TslNode): TslNode {
  const combined: TslNode = vec3(packed.x, packed.y, max(packed.z, aux.y));
  return debugMode.lessThan(1.5).select(
    vec3(aux.x),
    debugMode.lessThan(2.5).select(
      vec3(packed.x),
      debugMode.lessThan(3.5).select(
        vec3(packed.y),
        debugMode.lessThan(4.5).select(
          vec3(packed.z),
          debugMode.lessThan(5.5).select(vec3(packed.w), combined),
        ),
      ),
    ),
  );
}

