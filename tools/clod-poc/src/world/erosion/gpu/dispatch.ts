import { assertErosionNotAborted } from "../abort.js";
import { validateErosionGpuCheckpoint } from "../checkpoint.js";
import { EROSION_GPU_PERSIST_GROUP_MULTIPLIER } from "../constants.js";
import { resolveErosionConstants } from "../state.js";
import type {
  ErosionBuildProgress,
  ErosionGpuCheckpoint,
  ErosionGpuInitialState,
  ErosionGpuRawOutput,
  PersistedErosionArtifact,
  TerrainErosionConfig,
} from "../types.js";
import {
  GPU_PARAMS_BYTES,
  GPU_PARAMS_STRIDE_BYTES,
  createErosionGpuBuffers,
  createErosionGpuOutputBuffer,
  destroyErosionGpuBuffers,
  destroyErosionGpuSimulationBuffers,
} from "./buffers.js";
import { finalizeErosionGpuRawOutput } from "./finalize.js";
import { createErosionGpuPipelines, type ErosionGpuPipelines } from "./pipeline.js";
import { readErosionGpuCheckpoint, readErosionGpuOutputChunks } from "./readback.js";
import { createErosionGpuTimingBatch, mergeErosionGpuPassTimings, type ErosionGpuTimingBatch } from "./timing.js";

export interface ErosionGpuBuildInput {
  readonly worldId: string;
  readonly seed: number;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly config: TerrainErosionConfig;
  readonly initial: ErosionGpuInitialState;
  readonly checkpoint?: ErosionGpuCheckpoint;
  readonly signal?: AbortSignal;
}

export interface ErosionGpuBuildOptions {
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
  readonly onCheckpoint?: (checkpoint: ErosionGpuCheckpoint) => boolean | void | Promise<boolean | void>;
  readonly onMainThreadSlice?: (elapsedMs: number) => void;
}

function initialMetadataMatches(checkpoint: ErosionGpuCheckpoint, initial: ErosionGpuInitialState): boolean {
  return checkpoint.initial.sourceWidth === initial.sourceWidth
    && checkpoint.initial.sourceHeight === initial.sourceHeight
    && checkpoint.initial.width === initial.width
    && checkpoint.initial.height === initial.height
    && checkpoint.initial.borderCells === initial.borderCells
    && checkpoint.initial.cellSizeM === initial.cellSizeM
    && checkpoint.initial.originX === initial.originX
    && checkpoint.initial.originZ === initial.originZ;
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
  bindGroup: GPUBindGroup,
  dynamicOffset: number,
  workgroupsX: number,
  workgroupsZ: number,
  label: string,
  timing: ErosionGpuTimingBatch,
): void {
  const pass = encoder.beginComputePass(timing.passDescriptor(label));
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup, [dynamicOffset]);
  pass.dispatchWorkgroups(workgroupsX, workgroupsZ);
  pass.end();
}

function encodeThermal(
  encoder: GPUCommandEncoder,
  pipelines: ErosionGpuPipelines,
  bindGroup: GPUBindGroup,
  workgroupsX: number,
  workgroupsZ: number,
  timing: ErosionGpuTimingBatch,
): void {
  dispatchPass(encoder, pipelines.thermalClear, bindGroup, 0, workgroupsX, workgroupsZ, "erosion-thermal-clear", timing);
  dispatchPass(encoder, pipelines.thermalAccumulate, bindGroup, 0, workgroupsX, workgroupsZ, "erosion-thermal-accumulate", timing);
  dispatchPass(encoder, pipelines.thermalApply, bindGroup, 0, workgroupsX, workgroupsZ, "erosion-thermal-apply", timing);
}

async function submitTimedBatch(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  timing: ErosionGpuTimingBatch,
  totals: Record<string, number>,
): Promise<number> {
  timing.encodeResolve(encoder);
  const startedAt = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const wallMs = performance.now() - startedAt;
  try {
    mergeErosionGpuPassTimings(totals, await timing.collect());
  } finally {
    timing.destroy();
  }
  return wallMs;
}

export async function buildErosionGpuRaw(
  device: GPUDevice,
  input: ErosionGpuBuildInput,
  options: ErosionGpuBuildOptions = {},
): Promise<ErosionGpuRawOutput> {
  assertErosionNotAborted(input.signal);
  const startedAt = performance.now();
  const checkpoint = input.checkpoint
    ? validateErosionGpuCheckpoint(input.checkpoint, input.sourceTerrainHash, input.configHash)
    : undefined;
  if (checkpoint && !initialMetadataMatches(checkpoint, input.initial)) {
    throw new Error("erosion GPU checkpoint source dimensions do not match the sampled terrain");
  }
  const resolved = paramsData(input);
  const buffers = createErosionGpuBuffers(device, input.initial, resolved.data, resolved.talus, checkpoint);
  let gpuMs = 0;
  let readbackMs = 0;
  let checkpointCount = 0;
  let checkpointingEnabled = options.onCheckpoint !== undefined;
  let submissionCount = 0;
  let simulationBuffersDestroyed = false;
  let outputDestroyed = false;
  const passTimingsMs: Record<string, number> = {};
  const timestampQueriesSupported = device.features.has("timestamp-query");
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
    const persistenceInterval = Math.max(
      input.config.erosion.checkpointEveryIterations,
      input.config.erosion.checkpointEveryIterations * EROSION_GPU_PERSIST_GROUP_MULTIPLIER,
    );
    let hydraulicIteration = checkpoint?.hydraulicIteration ?? 0;
    let thermalIteration = checkpoint?.thermalIteration ?? 0;
    if (hydraulicIteration > hydraulicTarget || thermalIteration > thermalTarget) {
      throw new Error("erosion GPU checkpoint iterations exceed the configured targets");
    }
    const report = (phase: ErosionBuildProgress["phase"], percent: number): void => options.onProgress?.({
      phase,
      hydraulicIteration,
      thermalIteration,
      percent,
      checkpointCount,
    });
    const persistCheckpoint = async (): Promise<void> => {
      if (!checkpointingEnabled || !options.onCheckpoint) return;
      assertErosionNotAborted(input.signal);
      const snapshot = await readErosionGpuCheckpoint(
        device,
        buffers,
        input.initial,
        input.sourceTerrainHash,
        input.configHash,
        hydraulicIteration,
        thermalIteration,
        input.signal,
      );
      readbackMs += snapshot.readbackMs;
      options.onMainThreadSlice?.(snapshot.maxMainThreadSliceMs);
      const persisted = await options.onCheckpoint(snapshot.checkpoint);
      assertErosionNotAborted(input.signal);
      if (persisted === false) {
        checkpointingEnabled = false;
        return;
      }
      checkpointCount++;
    };

    report(checkpoint ? "hydraulic" : "sampling", checkpoint ? Math.min(99, hydraulicIteration / Math.max(1, hydraulicTarget) * 100) : 0);
    while (hydraulicIteration < hydraulicTarget) {
      assertErosionNotAborted(input.signal);
      const groupEnd = Math.min(hydraulicTarget, hydraulicIteration + input.config.erosion.checkpointEveryIterations);
      const maxPasses = (groupEnd - hydraulicIteration) * 11;
      const timing = createErosionGpuTimingBatch(device, maxPasses);
      const encoder = device.createCommandEncoder({ label: `erosion-submit-${submissionCount}` });
      while (hydraulicIteration < groupEnd) {
        const dynamicOffset = hydraulicIteration * GPU_PARAMS_STRIDE_BYTES;
        dispatchPass(encoder, pipelines.rain, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-rain", timing);
        dispatchPass(encoder, pipelines.flux, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-flux", timing);
        dispatchPass(encoder, pipelines.water, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-water", timing);
        dispatchPass(encoder, pipelines.capacity, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-capacity", timing);
        dispatchPass(encoder, pipelines.apply, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-apply", timing);
        dispatchPass(encoder, pipelines.advectClear, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-advect-clear", timing);
        dispatchPass(encoder, pipelines.advectScatter, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-advect-scatter", timing);
        dispatchPass(encoder, pipelines.evaporate, pipelines.bindGroup, dynamicOffset, workgroupsX, workgroupsZ, "erosion-evaporate", timing);
        hydraulicIteration++;
        if (hydraulicIteration % 4 === 0 && thermalIteration < thermalTarget) {
          encodeThermal(encoder, pipelines, pipelines.bindGroup, workgroupsX, workgroupsZ, timing);
          thermalIteration++;
        }
      }
      gpuMs += await submitTimedBatch(device, encoder, timing, passTimingsMs);
      assertErosionNotAborted(input.signal);
      submissionCount++;
      if (hydraulicIteration === hydraulicTarget || hydraulicIteration % persistenceInterval === 0) await persistCheckpoint();
      const completed = hydraulicIteration * 10 + thermalIteration;
      const total = hydraulicTarget * 10 + thermalTarget;
      report("hydraulic", total === 0 ? 99 : Math.min(99, completed / total * 100));
    }
    while (thermalIteration < thermalTarget) {
      assertErosionNotAborted(input.signal);
      const groupEnd = Math.min(thermalTarget, thermalIteration + input.config.erosion.checkpointEveryIterations);
      const timing = createErosionGpuTimingBatch(device, (groupEnd - thermalIteration) * 3);
      const encoder = device.createCommandEncoder({ label: `erosion-thermal-submit-${submissionCount}` });
      while (thermalIteration < groupEnd) {
        encodeThermal(encoder, pipelines, pipelines.bindGroup, workgroupsX, workgroupsZ, timing);
        thermalIteration++;
      }
      gpuMs += await submitTimedBatch(device, encoder, timing, passTimingsMs);
      assertErosionNotAborted(input.signal);
      submissionCount++;
      if (thermalIteration === thermalTarget || thermalIteration % persistenceInterval === 0) await persistCheckpoint();
      report("thermal", Math.min(99, (hydraulicTarget * 10 + thermalIteration) / Math.max(1, hydraulicTarget * 10 + thermalTarget) * 100));
    }
    report("encoding", 99);
    const output = createErosionGpuOutputBuffer(device, buffers, input.initial.sourceWidth * input.initial.sourceHeight);
    const outputBindGroup = pipelines.createOutputBindGroup(output);
    const outputTiming = createErosionGpuTimingBatch(device, 1);
    const outputEncoder = device.createCommandEncoder({ label: "erosion-pack-output" });
    dispatchPass(
      outputEncoder,
      pipelines.packOutput,
      outputBindGroup,
      0,
      Math.ceil(input.initial.sourceWidth / 8),
      Math.ceil(input.initial.sourceHeight / 8),
      "erosion-pack-output",
      outputTiming,
    );
    gpuMs += await submitTimedBatch(device, outputEncoder, outputTiming, passTimingsMs);
    assertErosionNotAborted(input.signal);
    destroyErosionGpuSimulationBuffers(buffers);
    simulationBuffersDestroyed = true;
    const readback = await readErosionGpuOutputChunks(device, output, input.initial, input.signal);
    readbackMs += readback.readbackMs;
    options.onMainThreadSlice?.(readback.maxMainThreadSliceMs);
    output.destroy();
    outputDestroyed = true;
    assertErosionNotAborted(input.signal);
    return Object.freeze({
      initial: Object.freeze({
        sourceWidth: input.initial.sourceWidth,
        sourceHeight: input.initial.sourceHeight,
        width: input.initial.width,
        height: input.initial.height,
        borderCells: input.initial.borderCells,
        cellSizeM: input.initial.cellSizeM,
        originX: input.initial.originX,
        originZ: input.initial.originZ,
      }),
      chunks: readback.chunks,
      byteLength: readback.byteLength,
      samplingMs: input.initial.samplingMs,
      buildMs: input.initial.samplingMs + performance.now() - startedAt,
      gpuMs,
      readbackMs,
      checkpointCount,
      gpuPassTimingsMs: Object.freeze({ ...passTimingsMs }),
      timestampQueriesSupported,
    });
  } finally {
    if (!simulationBuffersDestroyed) destroyErosionGpuBuffers(buffers);
    else if (!outputDestroyed) buffers.output?.destroy();
  }
}

/** Small-grid utility for tests and the CPU/GPU parity gate. Production finalization runs in the worker. */
export async function buildErosionGpu(
  device: GPUDevice,
  input: ErosionGpuBuildInput,
  options: ErosionGpuBuildOptions = {},
): Promise<PersistedErosionArtifact> {
  const raw = await buildErosionGpuRaw(device, input, options);
  const artifact = await finalizeErosionGpuRawOutput({
    raw,
    sourceTerrainHash: input.sourceTerrainHash,
    configHash: input.configHash,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  options.onProgress?.({
    phase: "complete",
    hydraulicIteration: input.config.erosion.enabled ? input.config.erosion.hydraulicIterations : 0,
    thermalIteration: input.config.erosion.enabled ? input.config.erosion.thermalIterations : 0,
    percent: 100,
    checkpointCount: raw.checkpointCount,
  });
  return artifact;
}
