// TSL vertex-stage sampling for atlas-driven water clipmap levels (Phase W2).
//
// The static grid geometry stores grid indices (i, j) in position.xz; this builder
// turns them into world XZ from the per-snap origin uniform and fetches the water data
// from the shared streaming hydrology atlas (Layout A + B, see hydrologyAtlas.ts) with
// a manual validity-weighted bilinear over four textureLoads. A snap therefore costs
// one origin uniform and zero CPU field samples; texels arrive from the worker-built
// hydrology tiles through the atlas blit. Invalid texels (Layout A alpha < 0: no tile
// yet / outside the window) resolve to the deep-underground dry sentinel and correct
// themselves once tiles land.
//
// The river-surface shaping the CPU path applies (shapeRiverSurfaceY: thalweg dip,
// bank lift, riffles, cascade steps) is reproduced here from the same settings, with
// the local water-level drop estimated from two extra Layout A taps along the flow
// direction — the vertex-stage analogue of hydrologyRiverLocalDrop.
//
// Only imported from the WebGPU-only material modules (keeps three/tsl out of the
// WebGL bundle, mirroring water_node_static_grid.ts).
import * as THREE from "three";
import {
  clamp,
  cos,
  float,
  int,
  ivec2,
  max,
  min,
  positionLocal,
  select,
  sin,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";
import { RIVER_GEOMETRY_CELL_FADE_END, RIVER_GEOMETRY_CELL_FADE_START } from "./water_field_types.js";
import type { WaterAtlasGridHandle, WaterAtlasGridParams } from "./water_material_types.js";
import { buildWaterRampDiscard, type WaterStaticGridNodes } from "./water_node_static_grid.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const DRY_SENTINEL_Y = -1e4;

function smoothMask(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface WaterAtlasGridNodes extends Omit<WaterStaticGridNodes, "handle"> {
  handle: WaterAtlasGridHandle;
}

export function buildWaterAtlasGridNodes(grid: WaterAtlasGridParams): WaterAtlasGridNodes {
  const settings = readRiverMaterialSettings();
  const uOriginMin = uniform(new THREE.Vector2()) as TslNode;
  const uAtlasOrigin = uniform(new THREE.Vector2()) as TslNode;
  const uAtlasEnabled = uniform(0) as TslNode;

  const gridI: TslNode = positionLocal.x;
  const gridJ: TslNode = positionLocal.z;
  const worldX: TslNode = uOriginMin.x.add(gridI.mul(float(grid.levelCellSize)));
  const worldZ: TslNode = uOriginMin.y.add(gridJ.mul(float(grid.levelCellSize)));

  const maxTexel = float(grid.res - 1);
  const g: TslNode = vec2(worldX, worldZ).sub(uAtlasOrigin).div(float(grid.atlasCellSize));
  const inWindow: TslNode = uAtlasEnabled.greaterThan(float(0.5))
    .and(g.x.greaterThanEqual(float(0)))
    .and(g.y.greaterThanEqual(float(0)))
    .and(g.x.lessThanEqual(maxTexel))
    .and(g.y.lessThanEqual(maxTexel));
  const gc: TslNode = clamp(g, vec2(0), vec2(maxTexel));
  const base: TslNode = min(gc.floor(), vec2(float(grid.res - 2)));
  const f: TslNode = gc.sub(base);
  const i0: TslNode = ivec2(int(base.x), int(base.y));

  const loadA = (ox: number, oz: number): TslNode =>
    textureLoad(grid.atlasA, i0.add(ivec2(ox, oz)), int(0));
  const loadB = (ox: number, oz: number): TslNode =>
    textureLoad(grid.atlasB, i0.add(ivec2(ox, oz)), int(0));
  const a00: TslNode = loadA(0, 0);
  const a10: TslNode = loadA(1, 0);
  const a01: TslNode = loadA(0, 1);
  const a11: TslNode = loadA(1, 1);
  const b00: TslNode = loadB(0, 0);
  const b10: TslNode = loadB(1, 0);
  const b01: TslNode = loadB(0, 1);
  const b11: TslNode = loadB(1, 1);

  // Validity-weighted bilinear: corners without tile data (shoreDistance < 0) drop out
  // and the rest renormalize, so the atlas fill frontier degrades to fewer-tap
  // interpolation instead of pulling in zeroed texels.
  const valid = (a: TslNode): TslNode => select(a.w.greaterThanEqual(float(0)), float(1), float(0));
  const w00: TslNode = float(1).sub(f.x).mul(float(1).sub(f.y)).mul(valid(a00));
  const w10: TslNode = f.x.mul(float(1).sub(f.y)).mul(valid(a10));
  const w01: TslNode = float(1).sub(f.x).mul(f.y).mul(valid(a01));
  const w11: TslNode = f.x.mul(f.y).mul(valid(a11));
  const weightSum: TslNode = w00.add(w10).add(w01).add(w11);
  const invW: TslNode = float(1).div(max(weightSum, float(1e-6)));
  const blendA: TslNode = a00.mul(w00).add(a10.mul(w10)).add(a01.mul(w01)).add(a11.mul(w11)).mul(invW);
  const blendB: TslNode = b00.mul(w00).add(b10.mul(w10)).add(b01.mul(w01)).add(b11.mul(w11)).mul(invW);
  const hasData: TslNode = inWindow.and(weightSum.greaterThan(float(1e-5)));

  const waterYRaw: TslNode = blendA.x;
  const terrainYRaw: TslNode = blendA.z;
  const wetRaw: TslNode = clamp(blendA.y, float(0), float(1));
  const shoreRaw: TslNode = blendA.w;

  // Body identity from the heaviest wet corner (mirrors the CPU tile sampler's
  // nearest-wet-corner rule closely enough for the per-body colour presets).
  const kindWeight = (w: TslNode, a: TslNode): TslNode => w.mul(select(a.y.greaterThan(float(0.001)), float(1), float(0)));
  const k00: TslNode = kindWeight(w00, a00);
  const k10: TslNode = kindWeight(w10, a10);
  const k01: TslNode = kindWeight(w01, a01);
  const k11: TslNode = kindWeight(w11, a11);
  const bestK: TslNode = max(max(k00, k10), max(k01, k11));
  const bodyKindRaw: TslNode = select(
    bestK.lessThanEqual(float(0)),
    float(0),
    select(k00.equal(bestK), b00.w, select(k10.equal(bestK), b10.w, select(k01.equal(bestK), b01.w, b11.w))),
  );

  // Flow: Layout B carries (flowX, flowZ, flowStrength); direction normalizes and the
  // speed folds the wet mask like WaterField.sampleHydrology does with riverMask.
  const flowVec: TslNode = blendB.xy;
  const flowLen: TslNode = max(flowVec.length(), float(1e-5));
  const dir: TslNode = flowVec.div(flowLen);
  const speed: TslNode = max(blendB.z, float(0)).mul(wetRaw)
    .mul(select(flowLen.greaterThan(float(1e-4)), float(1), float(0)));

  // Local drop (vertex analogue of hydrologyRiverLocalDrop): water level two texels
  // upstream minus two texels downstream along the flow direction.
  const dropTexels = float(2);
  const tap = (offset: TslNode): TslNode => {
    const gt: TslNode = clamp(gc.add(offset), vec2(0), vec2(maxTexel));
    return textureLoad(grid.atlasA, ivec2(int(gt.x.add(float(0.5)).floor()), int(gt.y.add(float(0.5)).floor())), int(0));
  };
  const up: TslNode = tap(dir.mul(dropTexels).negate());
  const down: TslNode = tap(dir.mul(dropTexels));
  const dropValid: TslNode = valid(up).mul(valid(down));
  const dropRaw: TslNode = max(up.x.sub(down.x), float(0)).mul(dropValid)
    .mul(select(speed.greaterThan(float(1e-4)), float(1), float(0)));

  // cascadeWhitewaterDrop (water_field_helpers.ts) in TSL.
  const speedMask: TslNode = smoothstep(float(0), float(1), clamp(speed.div(float(0.75)), float(0), float(1)));
  const dropMask: TslNode = smoothstep(float(settings.cascadeDropStart), float(settings.cascadeDropEnd), dropRaw);
  const cascade: TslNode = speedMask.mul(dropMask);
  const drop: TslNode = dropRaw.mul(float(1).add(cascade.mul(float(settings.cascadeWhitewaterBoost))))
    .add(cascade.mul(float(settings.cascadeDropEnd * 0.35)));

  // flowSurfaceOffset (water_field_helpers.ts) in TSL. detailFade is a per-level
  // constant, so levels past the geometry fade skip the shaping entirely at build time.
  const detailFade = 1 - smoothMask(RIVER_GEOMETRY_CELL_FADE_START, RIVER_GEOMETRY_CELL_FADE_END, grid.levelCellSize);
  let waterY: TslNode = waterYRaw;
  if (detailFade > 0) {
    const depthHint: TslNode = waterYRaw.sub(terrainYRaw);
    const river: TslNode = wetRaw;
    const center: TslNode = smoothstep(float(0.42), float(0.96), wetRaw);
    const bank: TslNode = float(1).sub(center).mul(river);
    const speedN: TslNode = smoothstep(float(0), float(1), clamp(speed.div(float(1.15)), float(0), float(1)));
    const rapid: TslNode = max(speedN, smoothstep(float(0), float(1), clamp(drop.div(float(1.6)), float(0), float(1))));
    const along: TslNode = worldX.mul(dir.x).add(worldZ.mul(dir.y));
    const side: TslNode = worldX.mul(dir.y.negate()).add(worldZ.mul(dir.x));
    const channelWave: TslNode = sin(along.mul(float(0.36)).add(sin(side.mul(float(0.075))).mul(float(0.8))));
    const sideWave: TslNode = cos(side.mul(float(0.42)).add(along.mul(float(0.035))));
    const cascadeLip: TslNode = smoothstep(float(0), float(1),
      sin(along.mul(float(0.72)).add(sin(side.mul(float(0.11))).mul(float(0.9)))).mul(float(0.5)).add(float(0.5)));
    const cascadeSheet: TslNode = cascadeLip.mul(cascade).mul(center).mul(float(-settings.cascadeStepStrength));
    const cascadeRough: TslNode = channelWave.mul(float(0.65)).add(sideWave.mul(float(0.35)))
      .mul(float(settings.cascadeRoughnessStrength)).mul(cascade).mul(center);
    const centerTrough: TslNode = center.mul(smoothstep(float(0), float(1), clamp(depthHint.div(float(2.8)), float(0), float(1))))
      .mul(float(-settings.geometryThalwegDip));
    const bankLift: TslNode = bank.mul(float(1).add(rapid.mul(float(0.35)))).mul(float(settings.geometryBankLift));
    const riffle: TslNode = channelWave.mul(float(settings.geometryRiffleStrength)).mul(rapid)
      .add(sideWave.mul(float(settings.geometrySideRiffleStrength)).mul(rapid).mul(center));
    const raw: TslNode = centerTrough.add(bankLift).add(riffle).add(cascadeSheet).add(cascadeRough)
      .mul(river).mul(float(detailFade))
      .mul(select(depthHint.greaterThan(float(0)), float(1), float(0)))
      .mul(select(speed.greaterThan(float(1e-4)), float(1), float(0)))
      .mul(select(wetRaw.greaterThan(float(0.02)), float(1), float(0)));
    const maxDown: TslNode = max(depthHint.sub(float(0.035)), float(0));
    const offset: TslNode = clamp(raw, maxDown.negate(), float(settings.geometryMaxOffset));
    waterY = max(terrainYRaw.add(float(0.035)), waterYRaw.add(offset));
    // Keep still water (offset gated to 0) exactly at the raw level.
    waterY = select(offset.equal(float(0)), waterYRaw, waterY);
  }

  const positionNode: TslNode = vec3(
    worldX,
    select(hasData, waterY, float(DRY_SENTINEL_Y)),
    worldZ,
  );

  const wallDiscard = (depth: TslNode, flowSpeed: TslNode): TslNode =>
    buildWaterRampDiscard(depth, flowSpeed, grid.levelCellSize);

  const dryGate = (node: TslNode): TslNode => select(hasData, node, float(0));

  return {
    positionNode,
    terrainY: vertexStage(select(hasData, terrainYRaw, float(0))),
    bodyMask: vertexStage(dryGate(wetRaw)),
    bodyKind: vertexStage(dryGate(bodyKindRaw)),
    flow: vertexStage(select(hasData, vec4(dir.x, dir.y, speed, drop), vec4(0))),
    shoreDistance: vertexStage(dryGate(shoreRaw)),
    wallDiscard,
    handle: {
      setOrigin: (originMinX: number, originMinZ: number) => {
        uOriginMin.value.set(originMinX, originMinZ);
      },
      setWindow: (originX: number, originZ: number, enabled: boolean) => {
        uAtlasOrigin.value.set(originX, originZ);
        uAtlasEnabled.value = enabled ? 1 : 0;
      },
    },
  };
}
