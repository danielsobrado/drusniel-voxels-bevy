import { requestSharedWebGpuDevice } from "../../rendering/shared_webgpu_device.js";
import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import { isErosionAbort, throwErosionAbort } from "./abort.js";
import {
  recordGpuCheckpoint,
  recordGpuCheckpointPersistenceFailure,
  recordMainThreadSlice,
  resetErosionDiagnostics,
  updateErosionProgress,
} from "./diagnostics.js";
import { createErosionWorkerClient } from "./erosion_client.js";
import { buildErosionGpuRaw } from "./gpu/dispatch.js";
import { assertErosionGpuParity } from "./gpu/parity_gate.js";
import {
  clearActiveErodedMacroField,
  getActiveErosionWorldId,
  setLatestErosionArtifactRef,
} from "./integration.js";
import type { ErosionArtifact, ErosionBuildProgress, ErosionGpuCheckpoint, ErosionGpuInitialState, TerrainErosionConfig } from "./types.js";

const CPU_FALLBACK_MAX_CELLS = 512 * 512;

export interface BuildCanonicalErosionInput {
  readonly worldId: string;
  readonly seed: number;
  readonly seaLevelM: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM: { readonly x: number; readonly z: number };
  readonly terrainFieldConfig: TerrainFieldConfigInput | null;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly config: TerrainErosionConfig;
  readonly signal?: AbortSignal;
}

function sourceCellCount(input: BuildCanonicalErosionInput): number {
  const width = Math.floor(input.sizeM.x / input.config.erosion.cellSizeM) + 1;
  const height = Math.floor(input.sizeM.z / input.config.erosion.cellSizeM) + 1;
  return width * height;
}

function initialFromCheckpoint(checkpoint: ErosionGpuCheckpoint): ErosionGpuInitialState {
  return { ...checkpoint.initial, stateAData: new ArrayBuffer(0), samplingMs: 0 };
}

export async function buildCanonicalErosionArtifact(
  input: BuildCanonicalErosionInput,
  onProgress?: (progress: ErosionBuildProgress) => void,
): Promise<ErosionArtifact> {
  resetErosionDiagnostics(input.config.erosion.enabled);
  if (getActiveErosionWorldId() !== input.worldId) {
    clearActiveErodedMacroField();
    setLatestErosionArtifactRef(null);
  }
  if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
  const worker = createErosionWorkerClient();
  if (!worker) throw new Error("erosion source worker is unavailable");
  const cancelWorker = (): void => worker.cancel();
  const reportProgress = (progress: ErosionBuildProgress): void => {
    updateErosionProgress(progress.percent);
    onProgress?.(progress);
  };
  input.signal?.addEventListener("abort", cancelWorker);
  const storeKey = { sourceTerrainHash: input.sourceTerrainHash, configHash: input.configHash };
  try {
    const cached = await worker.loadArtifact(storeKey, input.worldId);
    if (cached) return cached;
    if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);

    let gpuFailure: unknown = null;
    try {
      const shared = await requestSharedWebGpuDevice();
      if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
      await assertErosionGpuParity(shared.device);
      if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
      let checkpoint = await worker.loadGpuCheckpoint(storeKey);
      if (checkpoint) recordGpuCheckpoint(checkpoint.stateAByteLength, true);

      const runGpu = async (resume: ErosionGpuCheckpoint | null): Promise<ErosionArtifact> => {
        const initial = resume
          ? initialFromCheckpoint(resume)
          : await worker.sampleInitial({
              worldId: input.worldId,
              seed: input.seed,
              seaLevelM: input.seaLevelM,
              sizeM: input.sizeM,
              originM: input.originM,
              terrainFieldConfig: input.terrainFieldConfig,
              config: input.config,
            });
        if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
        const raw = await buildErosionGpuRaw(shared.device, {
          worldId: input.worldId,
          seed: input.seed,
          sourceTerrainHash: input.sourceTerrainHash,
          configHash: input.configHash,
          config: input.config,
          initial,
          ...(resume ? { checkpoint: resume } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        }, {
          onProgress: reportProgress,
          onCheckpoint: async (next) => {
            try {
              await worker.saveGpuCheckpoint(next);
              recordGpuCheckpoint(next.stateAByteLength);
              return true;
            } catch (error) {
              if (isErosionAbort(error, input.signal)) throwErosionAbort(error, input.signal);
              recordGpuCheckpointPersistenceFailure();
              console.warn("[erosion] GPU checkpoint persistence disabled; continuing the active simulation", error);
              return false;
            }
          },
          onMainThreadSlice: recordMainThreadSlice,
        });
        if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
        const artifact = await worker.finalizeGpu({ ...storeKey, worldId: input.worldId, raw });
        if (input.signal?.aborted) throwErosionAbort(input.signal.reason, input.signal);
        reportProgress({
          phase: "complete",
          hydraulicIteration: input.config.erosion.enabled ? input.config.erosion.hydraulicIterations : 0,
          thermalIteration: input.config.erosion.enabled ? input.config.erosion.thermalIterations : 0,
          percent: 100,
          checkpointCount: artifact.checkpointCount,
        });
        return artifact;
      };

      try {
        return await runGpu(checkpoint);
      } catch (error) {
        if (isErosionAbort(error, input.signal)) throwErosionAbort(error, input.signal);
        if (!checkpoint || !(error instanceof Error) || !error.message.toLowerCase().includes("checkpoint")) throw error;
        console.warn("[erosion] persisted GPU checkpoint was invalid; rebuilding from the canonical source", error);
        await worker.clearCheckpoint(storeKey);
        checkpoint = null;
        return await runGpu(null);
      }
    } catch (error) {
      if (isErosionAbort(error, input.signal)) throwErosionAbort(error, input.signal);
      gpuFailure = error;
    }

    const cells = sourceCellCount(input);
    if (cells > CPU_FALLBACK_MAX_CELLS) {
      const message = gpuFailure instanceof Error ? gpuFailure.message : String(gpuFailure);
      throw new Error(`canonical erosion requires WebGPU for ${cells.toLocaleString()} cells; GPU build failed: ${message}`);
    }
    console.warn("[erosion] WebGPU path unavailable; using the exact CPU fallback for a small grid", gpuFailure);
    return await worker.build({
      worldId: input.worldId,
      seed: input.seed,
      seaLevelM: input.seaLevelM,
      sizeM: input.sizeM,
      originM: input.originM,
      terrainFieldConfig: input.terrainFieldConfig,
      sourceTerrainHash: input.sourceTerrainHash,
      configHash: input.configHash,
      config: input.config,
    }, reportProgress);
  } finally {
    input.signal?.removeEventListener("abort", cancelWorker);
    worker.dispose();
  }
}
