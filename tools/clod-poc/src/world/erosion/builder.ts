import { requestSharedWebGpuDevice } from "../../rendering/shared_webgpu_device.js";
import { IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import { recordErosionArtifact, resetErosionDiagnostics, updateErosionProgress } from "./diagnostics.js";
import { createErosionWorkerClient } from "./erosion_client.js";
import { buildErosionGpu } from "./gpu/dispatch.js";
import { setActiveErodedMacroField, setLatestErosionArtifactRef } from "./integration.js";
import type { ErosionArtifact, ErosionBuildProgress, TerrainErosionConfig } from "./types.js";
import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";

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

function activate(artifact: ErosionArtifact, worldId: string, cacheHit: boolean): ErosionArtifact {
  setActiveErodedMacroField(artifact.field);
  setLatestErosionArtifactRef(artifact.ref, worldId);
  recordErosionArtifact(artifact, cacheHit);
  return artifact;
}

function sourceCellCount(input: BuildCanonicalErosionInput): number {
  const width = Math.floor(input.sizeM.x / input.config.erosion.cellSizeM) + 1;
  const height = Math.floor(input.sizeM.z / input.config.erosion.cellSizeM) + 1;
  return width * height;
}

export async function buildCanonicalErosionArtifact(
  input: BuildCanonicalErosionInput,
  onProgress?: (progress: ErosionBuildProgress) => void,
): Promise<ErosionArtifact> {
  resetErosionDiagnostics(input.config.erosion.enabled);
  const reportProgress = (progress: ErosionBuildProgress): void => {
    updateErosionProgress(progress.percent);
    onProgress?.(progress);
  };
  const db = await openErosionArtifactDb();
  const store = new IndexedDbErosionArtifactStore(db, input.sourceTerrainHash, input.configHash);
  const worker = createErosionWorkerClient();
  if (!worker) {
    store.close();
    throw new Error("erosion source worker is unavailable");
  }
  try {
    const cached = await store.load();
    if (cached) return activate(cached, input.worldId, true);

    let gpuFailure: unknown = null;
    try {
      const shared = await requestSharedWebGpuDevice();
      const initial = await worker.sampleInitial({
        worldId: input.worldId,
        seed: input.seed,
        seaLevelM: input.seaLevelM,
        sizeM: input.sizeM,
        originM: input.originM,
        terrainFieldConfig: input.terrainFieldConfig,
        config: input.config,
      });
      const artifact = await buildErosionGpu(shared.device, {
        worldId: input.worldId,
        seed: input.seed,
        sourceTerrainHash: input.sourceTerrainHash,
        configHash: input.configHash,
        config: input.config,
        initial,
        signal: input.signal,
      }, { onProgress: reportProgress });
      await store.save(artifact);
      await store.clearCheckpoint();
      return activate(artifact, input.worldId, false);
    } catch (error) {
      gpuFailure = error;
    }

    const cells = sourceCellCount(input);
    if (cells > CPU_FALLBACK_MAX_CELLS) {
      const message = gpuFailure instanceof Error ? gpuFailure.message : String(gpuFailure);
      throw new Error(`canonical erosion requires WebGPU for ${cells.toLocaleString()} cells; GPU build failed: ${message}`);
    }
    console.warn("[erosion] WebGPU path unavailable; using the exact CPU fallback for a small grid", gpuFailure);
    const artifact = await worker.build({
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
    return activate(artifact, input.worldId, false);
  } finally {
    worker.dispose();
    store.close();
  }
}
