import * as THREE from "three";
import {
  Break,
  float,
  floor,
  Fn,
  If,
  Loop,
  mix,
  normalize,
  reflect,
  smoothstep,
  storage,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { WaterVisualConfig } from "./waterConfig.js";
import { waterFarSummaryReflectionActive } from "./water_reflection_tiers.js";
import { acquireWaterFarReflectionGpuSource } from "./water_far_reflection_gpu_source.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterFarReflectionNode {
  readonly color: TslNode;
  readonly hit: TslNode;
  syncVisual(visual: WaterVisualConfig): void;
  syncSource(): void;
  dispose(): void;
}

export function buildWaterFarReflectionNode(input: {
  readonly worldPos: TslNode;
  readonly normal: TslNode;
  readonly cameraPosition: TslNode;
  readonly skyReflection: TslNode;
  readonly visual: WaterVisualConfig;
  readonly levelCellSizeM: number | null;
}): WaterFarReflectionNode {
  const policy = input.visual.reflection.farSummary;
  const gpu = acquireWaterFarReflectionGpuSource(policy.sourceResolution);
  const maxCells = policy.sourceResolution * policy.sourceResolution;
  const source = storage(gpu.attribute, "vec4", maxCells).toReadOnly();
  const uActive = uniform(waterFarSummaryReflectionActive(input.visual, input.levelCellSizeM) ? 1 : 0) as TslNode;
  const uSourceValid = uniform(0) as TslNode;
  const uOrigin = uniform(new THREE.Vector2()) as TslNode;
  const uCellSize = uniform(1) as TslNode;
  const uResolution = uniform(policy.sourceResolution) as TslNode;
  const uMaxSteps = uniform(policy.maxSteps) as TslNode;
  const uStartDistance = uniform(policy.startDistanceM) as TslNode;
  const uMaxDistance = uniform(policy.maxDistanceM) as TslNode;
  const uStepGrowth = uniform(policy.stepGrowth) as TslNode;
  const uThickness = uniform(policy.thicknessM) as TslNode;
  const uTerrainStrength = uniform(policy.terrainStrength) as TslNode;
  const uPropStrength = uniform(policy.propStrength) as TslNode;

  const result = Fn(() => {
    const hit = float(0).toVar();
    const propHit = float(0).toVar();
    const hitDistance = uMaxDistance.toVar();
    const incident = normalize(input.worldPos.sub(input.cameraPosition));
    const reflectionDirection = reflect(
      incident,
      vec3(input.normal.x.mul(0.55), input.normal.y, input.normal.z.mul(0.55)).normalize(),
    );
    const distanceM = uStartDistance.toVar();

    If(uActive.mul(uSourceValid).greaterThan(0.5), () => {
      Loop(uMaxSteps.toUint(), () => {
        If(distanceM.greaterThan(uMaxDistance), () => { Break(); });
        const point = input.worldPos.add(reflectionDirection.mul(distanceM));
        const grid = point.xz.sub(uOrigin).div(uCellSize);
        const inside = grid.x.greaterThanEqual(0)
          .and(grid.y.greaterThanEqual(0))
          .and(grid.x.lessThan(uResolution.sub(1)))
          .and(grid.y.lessThan(uResolution.sub(1)));
        If(inside, () => {
          const cell = floor(grid);
          const index = cell.y.mul(uResolution).add(cell.x);
          const sample = source.element(index);
          const verticalDelta = point.y.sub(sample.x);
          const intersects = sample.w.greaterThan(0.5)
            .and(verticalDelta.lessThanEqual(uThickness))
            .and(verticalDelta.greaterThan(uThickness.mul(-2)));
          If(intersects, () => {
            hit.assign(1);
            propHit.assign(sample.z);
            hitDistance.assign(distanceM);
            Break();
          });
        });
        distanceM.assign(distanceM.mul(uStepGrowth));
      });
    });

    const blockerColor = mix(vec3(0.12, 0.14, 0.10), vec3(0.09, 0.10, 0.095), propHit);
    const strength = mix(uTerrainStrength, uPropStrength, propHit);
    const distanceFade = float(1).sub(smoothstep(uMaxDistance.mul(0.55), uMaxDistance, hitDistance));
    const color = mix(input.skyReflection, blockerColor, hit.mul(strength).mul(distanceFade));
    return vec4(color, hit);
  })();

  const syncVisual = (visual: WaterVisualConfig): void => {
    const next = visual.reflection.farSummary;
    uActive.value = waterFarSummaryReflectionActive(visual, input.levelCellSizeM) ? 1 : 0;
    uMaxSteps.value = next.maxSteps;
    uStartDistance.value = next.startDistanceM;
    uMaxDistance.value = next.maxDistanceM;
    uStepGrowth.value = next.stepGrowth;
    uThickness.value = next.thicknessM;
    uTerrainStrength.value = next.terrainStrength;
    uPropStrength.value = next.propStrength;
  };

  const syncSource = (): void => {
    gpu.sync();
    uSourceValid.value = gpu.metadata.valid;
    uOrigin.value.copy(gpu.metadata.origin);
    uCellSize.value = gpu.metadata.cellSizeM;
    uResolution.value = gpu.metadata.resolution;
  };
  syncSource();

  return {
    color: result.rgb,
    hit: result.a,
    syncVisual,
    syncSource,
    dispose: () => gpu.release(),
  };
}
