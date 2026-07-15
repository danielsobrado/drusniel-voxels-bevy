import { compactHydrologyGraph, createHydrologyGraphArtifact, type HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import { buildHydrologyGraphFromErodedMacro } from "./hydrology_graph_erosion.js";
import type { HydrologyGraphWorkerBuildRequest } from "./hydrology_graph_worker_protocol.js";

export interface HydrologyGraphBuildProgress {
  readonly buildPct: number;
  readonly sampledRows: number;
  readonly totalRows: number;
}

export async function buildHydrologyGraphWorkerRequest(
  request: HydrologyGraphWorkerBuildRequest,
  onProgress: (progress: HydrologyGraphBuildProgress) => void = () => undefined,
): Promise<HydrologyGraphArtifact> {
  const startedAt = performance.now();
  onProgress({ buildPct: 5, sampledRows: 0, totalRows: request.erodedMacroField.height });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const graph = compactHydrologyGraph(buildHydrologyGraphFromErodedMacro(
    request,
    request.erodedMacroField,
    request.erosionArtifactRef,
  ));
  onProgress({
    buildPct: 100,
    sampledRows: request.erodedMacroField.height,
    totalRows: request.erodedMacroField.height,
  });
  return createHydrologyGraphArtifact(graph, performance.now() - startedAt);
}
