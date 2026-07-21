import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  Fn,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { WaterMaterialHandle, WaterMaterialParams } from "./water_material_types.js";
import { waterMaterialLevelCellSize } from "./water_reflection_tier_clipmap.js";
import { waterFarSummaryReflectionActive } from "./water_reflection_tiers.js";
import { buildWaterFarReflectionNode } from "./water_far_reflection_node.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export function decorateWaterFarReflection(
  handle: WaterMaterialHandle,
  params: WaterMaterialParams,
): WaterMaterialHandle {
  const material = handle.material as MeshBasicNodeMaterial;
  const baseFragment = material.fragmentNode as TslNode | null;
  if (!baseFragment) return handle;

  const levelCellSizeM = waterMaterialLevelCellSize(params);
  if (!waterFarSummaryReflectionActive(params.visual, levelCellSizeM)) return handle;

  const uTime = uniform(0) as TslNode;
  const uDebugMode = uniform(0) as TslNode;
  const uFresnelPower = uniform(params.visual.fresnel.power) as TslNode;
  const uRippleSpeed = uniform(params.visual.rippleSpeed) as TslNode;
  const uRippleScaleA = uniform(params.visual.rippleScaleA) as TslNode;
  const uRippleScaleB = uniform(params.visual.rippleScaleB) as TslNode;
  const uRippleStrengthA = uniform(params.visual.rippleStrengthA) as TslNode;
  const uRippleStrengthB = uniform(params.visual.rippleStrengthB) as TslNode;
  const worldPos: TslNode = positionWorld;
  const phaseA = worldPos.x.mul(uRippleScaleA).add(worldPos.z.mul(uRippleScaleA.mul(0.71))).add(uTime.mul(uRippleSpeed));
  const phaseB = worldPos.z.mul(uRippleScaleB).sub(worldPos.x.mul(uRippleScaleB.mul(0.63))).sub(uTime.mul(uRippleSpeed.mul(0.83)));
  const marchNormal = normalize(vec3(
    cos(phaseA).mul(uRippleStrengthA).add(sin(phaseB).mul(uRippleStrengthB)).mul(0.28),
    1,
    sin(phaseA).mul(uRippleStrengthA).add(cos(phaseB).mul(uRippleStrengthB)).mul(0.28),
  ));
  const viewDir = normalize(cameraPosition.sub(worldPos));
  const horizon = clamp(viewDir.y.mul(0.5).add(0.5), 0, 1);
  const analyticSky = mix(vec3(0.035, 0.07, 0.14), vec3(0.20, 0.36, 0.52), horizon);
  const far = buildWaterFarReflectionNode({
    worldPos,
    normal: marchNormal,
    cameraPosition,
    skyReflection: analyticSky,
    visual: params.visual,
    levelCellSizeM,
  });

  material.fragmentNode = Fn(() => {
    const base = baseFragment;
    const fresnel = pow(float(1).sub(clamp(dot(viewDir, marchNormal), 0, 1)), uFresnelPower);
    const weight = far.hit.mul(clamp(fresnel.mul(0.72), 0, 0.72));
    const reflected = mix(base.rgb, far.color, weight);
    const debug = vec3(far.hit, far.hit.mul(0.18), float(0));
    return uDebugMode.equal(16).select(vec4(debug, 1), vec4(reflected, base.a));
  })();

  const setTime = handle.setTime.bind(handle);
  const setDebugMode = handle.setDebugMode.bind(handle);
  const updateVisual = handle.updateVisual.bind(handle);
  const dispose = handle.dispose.bind(handle);
  handle.setTime = (timeS) => {
    setTime(timeS);
    uTime.value = timeS;
    far.syncSource();
  };
  handle.setDebugMode = (mode) => {
    setDebugMode(mode);
    uDebugMode.value = mode;
  };
  handle.updateVisual = (visual) => {
    updateVisual(visual);
    uFresnelPower.value = visual.fresnel.power;
    uRippleSpeed.value = visual.rippleSpeed;
    uRippleScaleA.value = visual.rippleScaleA;
    uRippleScaleB.value = visual.rippleScaleB;
    uRippleStrengthA.value = visual.rippleStrengthA;
    uRippleStrengthB.value = visual.rippleStrengthB;
    far.syncVisual(visual);
  };
  handle.dispose = () => {
    far.dispose();
    dispose();
  };
  return handle;
}
