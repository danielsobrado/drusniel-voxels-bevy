import farSummaryBindings from "./shaders/far_summary_bindings.wgsl?raw";
import terrainFieldCommon from "../gpu/shaders/terrain_field_common.wgsl?raw";
import farSummaryBuild from "./shaders/far_summary_build.wgsl?raw";
import { composeShader } from "../gpu/wgsl_compose.js";

export function composeFarSummaryGpuBuildShader(): string {
  return composeShader("far summary gpu build shader", [
    farSummaryBindings,
    terrainFieldCommon,
    farSummaryBuild,
  ]);
}
