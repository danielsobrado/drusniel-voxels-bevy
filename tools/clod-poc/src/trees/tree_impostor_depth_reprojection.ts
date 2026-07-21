import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  max,
  mix,
  normalize,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import { treeMorphologyRecordNodes } from "./morphology/node_deformation.js";
import {
  TREE_IMPOSTOR_DEPTH_ENCODING,
  treeImpostorDepthRange,
} from "./tree_impostor_depth_contract.js";
import { treeImpostorDepthAgeSampleNode } from "./tree_impostor_depth_sampling.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const DEPTH_COVERAGE_FADE_START = 0.01;
const DEPTH_COVERAGE_FADE_END = 0.15;

export interface TreeImpostorDepthReprojectionNode {
  readonly active: boolean;
  apply(sourcePosition: TslNode): TslNode;
}

export function createTreeImpostorDepthReprojectionNode(
  atlas: TreeImpostorAtlas,
  buffers: TreeRingInstanceBuffers,
): TreeImpostorDepthReprojectionNode {
  if (
    atlas.depthEncoding !== TREE_IMPOSTOR_DEPTH_ENCODING
    || !atlas.normalDepth
    || !atlas.radius
    || !Number.isFinite(atlas.radius)
  ) {
    return { active: false, apply: (sourcePosition) => sourcePosition };
  }

  const record = treeMorphologyRecordNodes(buffers);
  const worldXZ: TslNode = record.positionScale.xz;
  const groundY: TslNode = record.positionScale.y;
  const instanceScale: TslNode = max(record.positionScale.w, float(0.001));
  const age: TslNode = clamp(record.morphology0.x, 0, 1);
  const variantIndex: TslNode = clamp(
    record.rotationNormalY.z,
    0,
    Math.max(0, (atlas.variantCount ?? 1) - 1),
  );
  const yaw: TslNode = record.rotationNormalY.x;
  const yawCos: TslNode = cos(yaw);
  const yawSin: TslNode = sin(yaw);
  const centerY = float(atlas.centerY ?? 0).mul(instanceScale).add(groundY);
  const toCamera: TslNode = (vec3 as (...args: TslNode[]) => TslNode)(
    cameraPosition.x.sub(worldXZ.x),
    cameraPosition.y.sub(centerY),
    cameraPosition.z.sub(worldXZ.y),
  );
  const cameraRay: TslNode = dot(toCamera, toCamera)
    .greaterThan(float(0.000001))
    .select(normalize(toCamera), vec3(0, 0, 1));
  const localViewDirection: TslNode = normalize((vec3 as (...args: TslNode[]) => TslNode)(
    cameraRay.x.mul(yawCos).sub(cameraRay.z.mul(yawSin)),
    cameraRay.y,
    cameraRay.x.mul(yawSin).add(cameraRay.z.mul(yawCos)),
  ));
  const sample = treeImpostorDepthAgeSampleNode(atlas, uv(), localViewDirection, variantIndex, age);
  const range = treeImpostorDepthRange(atlas.radius);
  const offsetM: TslNode = clamp(
    clamp(sample.depth, 0, 1).mul(2).sub(1).mul(range.extentM),
    -range.extentM,
    range.extentM,
  );
  const coverageWeight: TslNode = smoothstep(
    DEPTH_COVERAGE_FADE_START,
    DEPTH_COVERAGE_FADE_END,
    clamp(sample.coverage, 0, 1),
  );
  const topWeight: TslNode = clamp(attribute("treeHeight01", "float"), 0, 1);
  const heightScale: TslNode = mix(0.72, 1.08, smoothstep(0, 1, age))
    .mul(mix(1, clamp(record.morphology1.w, 0.82, 1.2), topWeight));
  const widthScale: TslNode = clamp(record.morphology1.z, 0.82, 1.18)
    .mul(mix(0.78, 1.12, age));
  const weightedOffset: TslNode = offsetM.mul(coverageWeight).mul(instanceScale);
  const localDepth: TslNode = vec3(
    localViewDirection.x.mul(widthScale),
    localViewDirection.y.mul(heightScale),
    localViewDirection.z.mul(widthScale),
  ).mul(weightedOffset);
  const worldDepth: TslNode = vec3(
    yawCos.mul(localDepth.x).add(yawSin.mul(localDepth.z)),
    localDepth.y,
    yawCos.mul(localDepth.z).sub(yawSin.mul(localDepth.x)),
  );

  return {
    active: true,
    apply(sourcePosition) {
      return sourcePosition.add(worldDepth);
    },
  };
}
