import { createErosionArtifact } from "../artifact_codec.js";
import { resolveErosionConstants } from "../state.js";
import type { ErosionArtifact, ErosionBuildProgress, ErosionGpuInitialState, TerrainErosionConfig } from "../types.js";
import {
  GPU_PARAMS_BYTES,
  GPU_PARAMS_STRIDE_BYTES,
  createErosionGpuBuffers,
  destroyErosionGpuBuffers,
  destroyErosionGpuSimulationBuffers,
} from "./buffers.js";
import { createErosionGpuPipelines, type ErosionGpuPipelines } from "./pipeline.js";
import { readErosionGpuOutput } from "./readback.js";

export interface ErosionGpuBuildInput {
  readonly worldId: string;
  readonly seed: number;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly config: TerrainErosionConfig;
  readonly initial: ErosionGpuInitialState;
  readonly signal?: AbortSignal;
}

export interface ErosionGpuBuildOptions {
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Erosion build cancelled", "AbortError");
}

function paramsData(input: ErosionGpuBuildInput): { data: ArrayBuffer; talus: Uint32Array } {
  const constants = resolveErosionConstants(input.config);
  const recordCount = Math.max(1, input.config.erosion.hydraulicIterations);
  const data = new ArrayBuffer(recordCount * GPU_PARAMS_STRIDE_BYTES);
  for (let iteration = 0; iteration < recordCount; iteration++) {
    const words = new Uint32Array(data, iteration * GPU_PARAMS_STRIDE_BYTES, GPU_PARAMS_BYTES / Uint32Array.BYTES_PER_ELEMENT);
    words.set([
      input.initial.width,
      input.initial.height,
      input.initial.borderCells,
      iteration,
      constants.rainWaterUnits,
      constants.rainVariationQ16,
      constants.fluxResponseQ16,
      constants.evaporationRetainQ16,
      constants.maxVelocityFixed,
      constants.capacityFactorQ16,
      constants.erosionRateQ16,
      constants.depositionRateQ16,
      constants.minimumSlopeQ16,
      constants.maxErosionSedimentUnits,
      constants.maxDepositionSedimentUnits,
      constants.thermalRateQ16,
      Math.max(1, Math.round(input.initial.cellSizeM * 256)),
      input.initial.sourceWidth,
      input.initial.sourceHeight,
      input.seed >>> 0,
    ]);
  }
  return { data, talus: constants.talusHeightUnitsByHardnessByte };
}

function dispatchPass(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  pipelines: ErosionGpuPipelines,
  dynamicOffset: number,
  workgroupsX: number,
  workgroupsZ: number,
  label: string,
): void {
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, pipelines.bindGroup, [dynamicOffset]);
  pass.dispatchWorkgroups(workgroupsX, workgroupsZ);
  pass.end();
}

function encodeThermal(
  encoder: GPUCommandEncoder,
  pipelines: ErosionGpuPipelines,
  workgroupsX: number,
  workgroupsZ: number,
): void {
  dispatchPass(encoder, pipelines.thermalClear, pipelines, 0, workgroupsX, workgroupsZ, "erosion-thermal-clear");
  dispatchPass(encoder, pipelines.thermalAccumulate, pipelines, 0, workgroupsX, workgroupsZ, "erosion-thermal-accumulate");
  dispatchPass(encoder, pipelines.thermalApply, pipelines, 0, workgroupsX, workgroupsZ, "erosion-thermal-apply");
}

function massErrorRatio(field: Awaited<ReturnType<typeof readErosionGpuOutput>>["field"]): number {
  let sourceMass = 0;
  let error = 0;
  for (let index = 0; index < field.heightFixed.length; index++) {
    sourceMass += field.heightFixed[index]! * 256 - field.deposition[index]!;
    error += field.sediment[index]! + field.deposition[index]!;
  }
  if (!Number.isSafeInteger(sourceMass) || !Number.isSafeInteger(error)) {
    throw new Error("GPU erosion mass diagnostics exceed deterministic JavaScript integer range");
  }
  return Math.abs(error) / Math.max(1, Math.abs(sourceMass));
}

export async function buildErosionGpu(
  device: GPUDevice,
  input: ErosionGpuBuildInput,
  options: ErosionGpuBuildOptions = {},
): Promise<ErosionArtifact> {
  assertNotCancelled(input.signal);
  const startedAt = performance.now();
  const resolved = paramsData(input);
  const buffers = createErosionGpuBuffers(device, input.initial, resolved.data, resolved.talus);
  let gpuMs = 0;
  let checkpointCount = 0;
  let simulationBuffersDestroyed = false;
  try {
    device.pushErrorScope("validation");
    let pipelines: ErosionGpuPipelines;
    try {
      pipelines = createErosionGpuPipelines(device, buffers);
    } catch (error) {
      await device.popErrorScope();
      throw error;
    }
    const pipelineError = await device.popErrorScope();
    if (pipelineError) throw new Error(`erosion GPU pipeline validation failed: ${pipelineError.message}`);
    const workgroupsX = Math.ceil(input.initial.width / 8);
    const workgroupsZ = Math.ceil(input.initial.height / 8);
    const hydraulicTarget = input.config.erosion.enabled ? input.config.erosion.hydraulicIterations : 0;
    const thermalTarget = input.config.erosion.enabled ? input.config.erosion.thermalIterations : 0;
    let hydraulicIteration = 0;
    let thermalIteration = 0;
    const report = (phase: ErosionBuildProgress["phase"], percent: number): void => options.onProgress?.({
      phase,
      hydraulicIteration,
      thermalIteration,
      percent,
      checkpointCount,
    });
    report("sampling", 0);
    while (hydraulicIteration < hydraulicTarget) {
      assertNotCancelled(input.signal);
      const groupEnd = Math.min(hydraulicTarget, hydraulicIteration + input.config.erosion.checkpointEveryIterations);
      const encoder = device.createCommandEncoder({ label: `erosion-checkpoint-${checkpointCount}` });
      while (hydraulicIteration < groupEnd) {
        const dynamicOffset = hydraulicIteration * GPU_PARAMS_STRIDE_BYTES;
        dispatchPass(encoder, pipelines.rain, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-rain");
        dispatchPass(encoder, pipelines.flux, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-flux");
        dispatchPass(encoder, pipelines.water, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-water");
        dispatchPass(encoder, pipelines.capacity, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-capacity");
        dispatchPass(encoder, pipelines.apply, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-apply");
        dispatchPass(encoder, pipelines.advectClear, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-advect-clear");
        dispatchPass(encoder, pipelines.advectScatter, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-advect-scatter");
        dispatchPass(encoder, pipelines.evaporate, pipelines, dynamicOffset, workgroupsX, workgroupsZ, "erosion-evaporate");
        hydraulicIteration++;
        if (hydraulicIteration % 4 === 0 && thermalIteration < thermalTarget) {
          encodeThermal(encoder, pipelines, workgroupsX, workgroupsZ);
          thermalIteration++;
        }
      }
      const gpuStartedAt = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      gpuMs += performance.now() - gpuStartedAt;
      checkpointCount++;
      const completed = hydraulicIteration * 10 + thermalIteration;
      const total = hydraulicTarget * 10 + thermalTarget;
      report("hydraulic", total === 0 ? 99 : Math.min(99, completed / total * 100));
    }
    while (thermalIteration < thermalTarget) {
      assertNotCancelled(input.signal);
      const groupEnd = Math.min(thermalTarget, thermalIteration + input.config.erosion.checkpointEveryIterations);
      const encoder = device.createCommandEncoder({ label: `erosion-thermal-checkpoint-${checkpointCount}` });
      while (thermalIteration < groupEnd) {
        encodeThermal(encoder, pipelines, workgroupsX, workgroupsZ);
        thermalIteration++;
      }
      const gpuStartedAt = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      gpuMs += performance.now() - gpuStartedAt;
      checkpointCount++;
      report("thermal", Math.min(99, (hydraulicTarget * 10 + thermalIteration) / Math.max(1, hydraulicTarget * 10 + thermalTarget) * 100));
    }
    report("encoding", 99);
    const outputEncoder = device.createCommandEncoder({ label: "erosion-pack-output" });
    dispatchPass(
      outputEncoder,
      pipelines.packOutput,
      pipelines,
      0,
      Math.ceil(input.initial.sourceWidth / 8),
      Math.ceil(input.initial.sourceHeight / 8),
      "erosion-pack-output",
    );
    const gpuStartedAt = performance.now();
    device.queue.submit([outputEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    gpuMs += performance.now() - gpuStartedAt;
    destroyErosionGpuSimulationBuffers(buffers);
    simulationBuffersDestroyed = true;
    const readback = await readErosionGpuOutput(device, buffers.output, input.initial);
    const artifact = await createErosionArtifact({
      field: readback.field,
      sourceTerrainHash: input.sourceTerrainHash,
      configHash: input.configHash,
      buildMs: performance.now() - startedAt,
      gpuMs,
      readbackMs: readback.readbackMs,
      checkpointCount,
      massErrorRatio: massErrorRatio(readback.field),
    });
    report("complete", 100);
    return artifact;
  } finally {
    if (simulationBuffersDestroyed) buffers.output.destroy();
    else destroyErosionGpuBuffers(buffers);
  }
}
