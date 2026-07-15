import { requestSharedWebGpuDevice } from "../../rendering/shared_webgpu_device.js";
import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import { isErosionAbort, throwErosionAbort } from "./abort.js";
import { recordGpuCheckpoint, recordMainThreadSlice, resetErosionDiagnostics } from "./diagnostics.js";
import { createErosionWorkerClient } from "./erosion_client.js";
import { buildErosionGpuRaw } from "./gpu/dispatch.js";
import { assertErosionGpuParity } from "./gpu/parity_gate.js";
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
  return { ...checkpoint.initial, stateAData: new ArrayBuffer(0) };
}

export async function buildCanonicalErosionArtifact(
  input: BuildCanonicalErosionInput,
  onProgress?: (progress: ErosionBuildProgress) => void,
): Promise<ErosionArtifact> {
  resetErosionDiagnostics(input.config.erosion.enabled);
  const worker = createErosionWorkerClient();
  if (!worker) throw new Error("erosion source worker is unavailable");
  const storeKey = { sourceTerrainHash: input.sourceTerrainHash, configHash: input.configHash };
  try {
    const cached = await worker.loadArtifact(storeKey, input.worldId);
    if (cached) return cached;

    let gpuFailure: unknown = null;
    try {
      const shared = await requestSharedWebGpuDevice();
      await assertErosionGpuParity(shared.device);
      let checkpoint = await worker.loadGpuCheckpoint(storeKey);
      if (checkpoint) recordGpuCheckpoint(checkpoint.stateAByteLength + checkpoint.stateBByteLength, true);

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
        const raw = await buildErosionGpuRaw(shared.device, {
          worldId: input.worldId,
          seed: input.seed,
          sourceTerrainHash: input.sourceTerrainHash,
          configHash: input.configHash,
          config: input.config,
          initial,
          ...(resume ? { checkpoint: resume } : {}),
          signal: input.signal,
        }, {
          onProgress,
          onCheckpoint: async (next) => {
            const byteLength = next.stateAByteLength + next.stateBByteLength;
            await worker.saveGpuCheckpoint(next);
            recordGpuCheckpoint(byteLength);
          },
          onMainThreadSlice: recordMainThreadSlice,
        });
        return worker.finalizeGpu({ ...storeKey, worldId: input.worldId, raw });
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
    const cancelWorker = (): void => worker.cancel();
    input.signal?.addEventListener("abort", cancelWorker, { once: true });
    try {
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
      }, onProgress);
    } finally {
      input.signal?.removeEventListener("abort", cancelWorker);
    }
  } finally {
    worker.dispose();
  }
}
