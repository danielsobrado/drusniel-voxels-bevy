import {
  abs,
  clamp,
  float,
  floor,
  max,
  texture,
  vec2,
} from "three/tsl";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const DEPTH_MIN_COVERAGE = 0.0001;
const DEPTH_SAMPLE_MIP_LEVEL = 0;

export interface TreeImpostorDepthSampleNode {
  readonly depth: TslNode;
  readonly coverage: TslNode;
}

export function treeImpostorDepthAgeSampleNode(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  viewDirection: TslNode,
  variantIndex: TslNode,
  age: TslNode,
): TreeImpostorDepthSampleNode {
  const ageLayerCount = atlas.ageBuckets?.length ?? 0;
  if (ageLayerCount !== 3 || (atlas.layerCount ?? 0) < (atlas.variantCount ?? 1) * ageLayerCount) {
    return treeImpostorDepthFourFrameSample(atlas, baseUv, viewDirection, variantIndex);
  }

  const young = age.lessThanEqual(float(0.20));
  const mature = age.lessThanEqual(float(0.60));
  const old = age.lessThan(float(0.92));
  const lowerBucket: TslNode = young.select(float(0), mature.select(float(0), old.select(float(1), float(2))));
  const upperBucket: TslNode = young.select(float(0), mature.select(float(1), old.select(float(2), float(2))));
  const layerBlend: TslNode = young.select(
    float(0),
    mature.select(
      clamp(age.sub(0.20).div(0.40), 0, 1),
      old.select(clamp(age.sub(0.60).div(0.32), 0, 1), float(0)),
    ),
  );
  const variantBase: TslNode = variantIndex.mul(ageLayerCount);
  const lower = treeImpostorDepthFourFrameSample(atlas, baseUv, viewDirection, variantBase.add(lowerBucket));
  const upper = treeImpostorDepthFourFrameSample(atlas, baseUv, viewDirection, variantBase.add(upperBucket));
  const lowerWeight: TslNode = float(1).sub(layerBlend).mul(lower.coverage);
  const upperWeight: TslNode = layerBlend.mul(upper.coverage);
  const coverage: TslNode = lowerWeight.add(upperWeight);
  return {
    depth: lower.depth.mul(lowerWeight).add(upper.depth.mul(upperWeight))
      .div(max(coverage, float(DEPTH_MIN_COVERAGE))),
    coverage,
  };
}

function treeImpostorDepthFourFrameSample(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  viewDirection: TslNode,
  variantIndex: TslNode,
): TreeImpostorDepthSampleNode {
  const encoded: TslNode = treeImpostorOctEncode(viewDirection);
  const grid = float(Math.max(1, Math.floor(atlas.gridSize)));
  const gridMax = grid.sub(1);
  const scaled: TslNode = encoded.mul(grid).sub(0.5);
  const cell0: TslNode = floor(scaled);
  const fraction: TslNode = clamp(scaled.sub(cell0), vec2(0), vec2(1));
  const x0: TslNode = clamp(cell0.x, 0, gridMax);
  const y0: TslNode = clamp(cell0.y, 0, gridMax);
  const x1: TslNode = clamp(cell0.x.add(1), 0, gridMax);
  const y1: TslNode = clamp(cell0.y.add(1), 0, gridMax);
  const one = float(1);
  const w00: TslNode = one.sub(fraction.x).mul(one.sub(fraction.y));
  const w10: TslNode = fraction.x.mul(one.sub(fraction.y));
  const w01: TslNode = one.sub(fraction.x).mul(fraction.y);
  const w11: TslNode = fraction.x.mul(fraction.y);
  const s00 = treeImpostorDepthAtlasSample(atlas, baseUv, x0, y0, variantIndex);
  const s10 = treeImpostorDepthAtlasSample(atlas, baseUv, x1, y0, variantIndex);
  const s01 = treeImpostorDepthAtlasSample(atlas, baseUv, x0, y1, variantIndex);
  const s11 = treeImpostorDepthAtlasSample(atlas, baseUv, x1, y1, variantIndex);
  const cw00: TslNode = s00.coverage.mul(w00);
  const cw10: TslNode = s10.coverage.mul(w10);
  const cw01: TslNode = s01.coverage.mul(w01);
  const cw11: TslNode = s11.coverage.mul(w11);
  const coverage: TslNode = cw00.add(cw10).add(cw01).add(cw11);
  return {
    depth: s00.depth.mul(cw00)
      .add(s10.depth.mul(cw10))
      .add(s01.depth.mul(cw01))
      .add(s11.depth.mul(cw11))
      .div(max(coverage, float(DEPTH_MIN_COVERAGE))),
    coverage,
  };
}

function treeImpostorDepthAtlasSample(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  frameX: TslNode,
  frameY: TslNode,
  variantIndex: TslNode,
): TreeImpostorDepthSampleNode {
  const atlasUv = treeImpostorDepthAtlasUv(atlas, baseUv, frameX, frameY, variantIndex);
  return {
    depth: texture(atlas.normalDepth!, atlasUv, DEPTH_SAMPLE_MIP_LEVEL).w,
    coverage: texture(atlas.albedo ?? atlas.texture, atlasUv, DEPTH_SAMPLE_MIP_LEVEL).w,
  };
}

function treeImpostorDepthAtlasUv(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  frameX: TslNode,
  frameY: TslNode,
  variantIndex: TslNode,
): TslNode {
  const resolution = float(Math.max(1, Math.floor(atlas.resolutionPx)));
  const pageSize = float(Math.max(1, Math.floor(atlas.gridSize * atlas.resolutionPx)));
  const atlasWidth = float(Math.max(1, Math.floor(atlas.atlasWidthPx ?? atlas.gridSize * atlas.resolutionPx)));
  const atlasHeight = float(Math.max(1, Math.floor(atlas.atlasHeightPx ?? atlas.gridSize * atlas.resolutionPx)));
  const pageCount = float(Math.max(1, Math.floor(atlas.layerCount ?? atlas.variantCount ?? 1)));
  const safePage = clamp(variantIndex, 0, pageCount.sub(1));
  const yOffset = safePage.mul(pageSize);
  const padding = float(inferAtlasPaddingPx(atlas));
  const minUv = vec2(
    frameX.mul(resolution).add(padding).div(atlasWidth),
    yOffset.add(frameY.mul(resolution)).add(padding).div(atlasHeight),
  );
  const maxUv = vec2(
    frameX.add(1).mul(resolution).sub(padding).div(atlasWidth),
    yOffset.add(frameY.add(1).mul(resolution).sub(padding).div(atlasHeight),
  );
  return minUv.add(clamp(baseUv, vec2(0), vec2(1)).mul(maxUv.sub(minUv)));
}

function treeImpostorOctEncode(direction: TslNode): TslNode {
  const l1: TslNode = max(abs(direction.x).add(abs(direction.y)).add(abs(direction.z)), float(0.0001));
  const projected: TslNode = direction.xy.div(l1);
  const signX: TslNode = direction.x.greaterThanEqual(float(0)).select(float(1), float(-1));
  const signY: TslNode = direction.y.greaterThanEqual(float(0)).select(float(1), float(-1));
  const folded: TslNode = vec2(
    float(1).sub(abs(projected.y)).mul(signX),
    float(1).sub(abs(projected.x)).mul(signY),
  );
  return direction.z.lessThan(float(0)).select(folded, projected).mul(0.5).add(0.5);
}

function inferAtlasPaddingPx(atlas: TreeImpostorAtlas): number {
  const first = atlas.frames[0];
  if (!first) return 0;
  return Math.max(0, Math.round(first.uvMin[0] * Math.max(1, atlas.gridSize * atlas.resolutionPx)));
}
