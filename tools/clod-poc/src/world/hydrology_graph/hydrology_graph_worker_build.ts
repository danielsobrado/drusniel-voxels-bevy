import { baseSurfaceHeight, setTerrainFieldConfig } from "../../terrain/terrain_surface.js";
import { compactHydrologyGraph, createHydrologyGraphArtifact, type HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import {
  buildHydrologyGraphFromMacro,
  createHydrologyMacroSampleCheckpoint,
  sampleHydrologyMacroRows,
} from "./hydrology_graph_builder.js";
import type { HydrologyGraphWorkerBuildRequest } from "./hydrology_graph_worker_protocol.js";

export interface HydrologyGraphBuildProgress {
  readonly buildPct: number;
  readonly sampledRows: number;
  readonly totalRows: number;
}

export async function buildHydrologyGraphWorkerRequest(
  request: HydrologyGraphWorkerBuildRequest,
  onProgress: (progress: HydrologyGraphBuildProgress) => void = () => undefined,
  yieldBetweenBands: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  rowsPerBand = 32,
): Promise<HydrologyGraphArtifact> {
  setTerrainFieldConfig(request.terrainFieldConfig);
  const checkpoint = request.checkpoint ?? createHydrologyMacroSampleCheckpoint(request);
  const startedAt = performance.now();
  while (checkpoint.nextRow < checkpoint.resZ) {
    sampleHydrologyMacroRows(checkpoint, baseSurfaceHeight, rowsPerBand);
    onProgress({
      buildPct: (checkpoint.nextRow / checkpoint.resZ) * 100,
      sampledRows: checkpoint.nextRow,
      totalRows: checkpoint.resZ,
    });
    if (checkpoint.nextRow < checkpoint.resZ) await yieldBetweenBands();
  }
  const graph = compactHydrologyGraph(buildHydrologyGraphFromMacro(request, checkpoint));
  return createHydrologyGraphArtifact(graph, performance.now() - startedAt);
}
