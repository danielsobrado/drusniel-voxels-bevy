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
  sin,
  smoothstep,
  storage,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import { TREE_FOLIAGE_ATLAS_COLUMNS, TREE_FOLIAGE_ATLAS_ROWS } from "./tree_alpha_mask.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
} from "./tree_ring_placement.js";

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
    ? createRingForestLighting(options.ring.settings, options.ring.buffers, regular)
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
  return handle;
}

function createTreeVisibilityNodes(atlas: TreeFoliageAtlas): {
  cardTag: TslNode;
  cardShade: TslNode;
  keep: TslNode;
} {
  const cardTag: TslNode = clamp(attribute("treeFoliageCard", "float"), 0, 1);
  const speciesAttribute: TslNode = attribute("treeSpeciesIndex", "float");
  const speciesIndex: TslNode = clamp(
    floor(speciesAttribute.add(0.5)),
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

  // Player cameras can enter a crown or pass very close to a trunk. Without a
  // small camera bubble, one card or branch can cover the entire near plane.
  // Use the same dither mask in color and depth prepass so the fade cannot leave
  // an invisible occluder or a one-frame depth slab.
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
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  material: NodeMaterialLike,
): {
  update(state: ForestLightingMaterialState | null): void;
  dispose(): void;
} {
  const neutralData = new Uint8Array([0, 0, 0, 0]);
  const neutralTexture = new THREE.DataTexture(neutralData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  neutralTexture.needsUpdate = true;

  const enabled = uniform(0);
  const worldSize = uniform(1);
  const aoStrength = uniform(1);
  const shadowStrength = uniform(1);
  const fogStrength = uniform(1);
  const fogColor = uniform(new THREE.Vector3(0.72, 0.78, 0.81));
  const seed = uniform(settings.seed);
  const cellSize = uniform(TREE_RING_CELL_SIZE_M);

  const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
  const cell: TslNode = cellStore.element(instanceIndex);
  const worldCell: TslNode = cell.xy;
  const jitter: TslNode = vec2(
    ringHash(worldCell, seed, TREE_RING_JITTER_X_SALT),
    ringHash(worldCell, seed, TREE_RING_JITTER_Z_SALT),
  );
  const worldXZ: TslNode = worldCell.add(jitter).mul(cellSize);
  const forestUv: TslNode = clamp(worldXZ.div(worldSize), vec2(0), vec2(1));
  const packed: TslNode = texture(neutralTexture, forestUv);

  if (material.colorNode) {
    const darken: TslNode = clamp(
      packed.x.mul(aoStrength).add(packed.y.mul(shadowStrength)),
      0,
      0.72,
    ).mul(enabled);
    const fog: TslNode = clamp(packed.z.mul(fogStrength).mul(enabled), 0, 0.35);
    material.colorNode = mix(
      material.colorNode.mul(float(1).sub(darken)),
      fogColor,
      fog,
    ).add(vec3(packed.w.mul(0.05).mul(enabled)));
  }

  return {
    update(state: ForestLightingMaterialState | null): void {
      if (!state) {
        enabled.value = 0;
        return;
      }
      const config = state.settings;
      enabled.value = config.enabled && config.materialIntegration.treeEnabled ? 1 : 0;
      worldSize.value = Math.max(1, state.worldCells);
      aoStrength.value = config.ambientOcclusion.strength;
      shadowStrength.value = config.shadowProxy.strength;
      fogStrength.value = config.atmosphere.forestFogStrength + config.atmosphere.aerialTintStrength;
      packed.value = state.textureHandle.texture;
    },
    dispose(): void {
      neutralTexture.dispose();
    },
  };
}

function ringHash(cell: TslNode, seed: TslNode, saltValue: number): TslNode {
  const salt = float(saltValue);
  return fract(
    sin(dot(
      cell.add(vec2(seed.add(salt), seed.mul(0.37).add(salt.mul(1.17)))),
      vec2(41.3, 289.1),
    )).mul(43758.5453),
  );
}
