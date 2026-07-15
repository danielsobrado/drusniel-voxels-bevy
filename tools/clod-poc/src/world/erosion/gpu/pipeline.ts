import rainShader from "./shaders/erosion_rain.compute.wgsl?raw";
import fluxShader from "./shaders/erosion_flux.compute.wgsl?raw";
import waterShader from "./shaders/erosion_water.compute.wgsl?raw";
import capacityShader from "./shaders/erosion_capacity.compute.wgsl?raw";
import applyShader from "./shaders/erosion_apply.compute.wgsl?raw";
import advectShader from "./shaders/erosion_advect.compute.wgsl?raw";
import evaporateShader from "./shaders/erosion_evaporate.compute.wgsl?raw";
import thermalShader from "./shaders/erosion_thermal.compute.wgsl?raw";
import initShader from "./shaders/erosion_init.compute.wgsl?raw";
import type { ErosionGpuBuffers } from "./buffers.js";
import { EROSION_COMMON_WGSL, createErosionBindGroupLayout } from "./layouts.js";

export interface ErosionGpuPipelines {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly bindGroup: GPUBindGroup;
  readonly rain: GPUComputePipeline;
  readonly flux: GPUComputePipeline;
  readonly water: GPUComputePipeline;
  readonly capacity: GPUComputePipeline;
  readonly apply: GPUComputePipeline;
  readonly advectClear: GPUComputePipeline;
  readonly advectScatter: GPUComputePipeline;
  readonly evaporate: GPUComputePipeline;
  readonly thermalClear: GPUComputePipeline;
  readonly thermalAccumulate: GPUComputePipeline;
  readonly thermalApply: GPUComputePipeline;
  readonly packOutput: GPUComputePipeline;
}

function module(device: GPUDevice, label: string, source: string): GPUShaderModule {
  return device.createShaderModule({ label, code: `${EROSION_COMMON_WGSL}\n${source}` });
}

function pipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  label: string,
  shader: GPUShaderModule,
  entryPoint = "main",
): GPUComputePipeline {
  return device.createComputePipeline({ label, layout, compute: { module: shader, entryPoint } });
}

export function createErosionGpuPipelines(device: GPUDevice, buffers: ErosionGpuBuffers): ErosionGpuPipelines {
  const bindGroupLayout = createErosionBindGroupLayout(device);
  const layout = device.createPipelineLayout({ label: "erosion-pipeline-layout", bindGroupLayouts: [bindGroupLayout] });
  const bindGroup = device.createBindGroup({
    label: "erosion-bind-group",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: buffers.stateA } },
      { binding: 1, resource: { buffer: buffers.stateB } },
      { binding: 2, resource: { buffer: buffers.sedimentScratch } },
      { binding: 3, resource: { buffer: buffers.params, offset: 0, size: 80 } },
      { binding: 4, resource: { buffer: buffers.talus } },
      { binding: 5, resource: { buffer: buffers.output } },
    ],
  });
  const rainModule = module(device, "erosion-rain-shader", rainShader);
  const fluxModule = module(device, "erosion-flux-shader", fluxShader);
  const waterModule = module(device, "erosion-water-shader", waterShader);
  const capacityModule = module(device, "erosion-capacity-shader", capacityShader);
  const applyModule = module(device, "erosion-apply-shader", applyShader);
  const advectModule = module(device, "erosion-advect-shader", advectShader);
  const evaporateModule = module(device, "erosion-evaporate-shader", evaporateShader);
  const thermalModule = module(device, "erosion-thermal-shader", thermalShader);
  const initModule = module(device, "erosion-output-shader", initShader);
  return {
    bindGroupLayout,
    bindGroup,
    rain: pipeline(device, layout, "erosion-rain", rainModule),
    flux: pipeline(device, layout, "erosion-flux", fluxModule),
    water: pipeline(device, layout, "erosion-water", waterModule),
    capacity: pipeline(device, layout, "erosion-capacity", capacityModule),
    apply: pipeline(device, layout, "erosion-apply", applyModule),
    advectClear: pipeline(device, layout, "erosion-advect-clear", advectModule, "clear_scratch"),
    advectScatter: pipeline(device, layout, "erosion-advect-scatter", advectModule, "scatter"),
    evaporate: pipeline(device, layout, "erosion-evaporate", evaporateModule),
    thermalClear: pipeline(device, layout, "erosion-thermal-clear", thermalModule, "clear_delta"),
    thermalAccumulate: pipeline(device, layout, "erosion-thermal-accumulate", thermalModule, "accumulate"),
    thermalApply: pipeline(device, layout, "erosion-thermal-apply", thermalModule, "apply_delta"),
    packOutput: pipeline(device, layout, "erosion-pack-output", initModule, "pack_output"),
  };
}
