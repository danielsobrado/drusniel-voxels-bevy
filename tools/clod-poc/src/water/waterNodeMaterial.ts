import {
  createWaterNodeMaterialImpl as createWaterNodeMaterialBase,
} from "./waterNodeMaterial_base.js";
import type {
  WaterMaterialHandle,
  WaterMaterialParams,
} from "./water_material_types.js";
import {
  decorateWaterSsrMissRouting,
  withoutConstantWaterSsrMissFallback,
} from "./water_ssr_miss_route.js";

export function createWaterNodeMaterialImpl(params: WaterMaterialParams): WaterMaterialHandle {
  const baseParams: WaterMaterialParams = {
    ...params,
    visual: withoutConstantWaterSsrMissFallback(params.visual),
  };
  return decorateWaterSsrMissRouting(createWaterNodeMaterialBase(baseParams), params);
}
