import terrainErosionConfigText from "../../../config/terrain_erosion.yaml?raw";
import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import { buildCanonicalErosionArtifact } from "../erosion/builder.js";
import {
  computeTerrainErosionConfigHash,
  parseTerrainErosionConfig,
  resolveRuntimeTerrainErosionConfig,
} from "../erosion/config.js";
import {
  clearActiveErodedMacroField,
  cloneSerializedErodedMacroField,
  collectSerializedErosionTransferables,
  computeErosionSourceTerrainHash,
  setActiveErodedMacroField,
  setLatestErosionArtifactRef,
  toErodedMacroField,
} from "../erosion/integration.js";
import type { HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import type { HydrologyGraphWorkerBuildRequest, HydrologyGraphWorkerResponse } from "./hydrology_graph_worker_protocol.js";

function publishStartupPhase(phase: string, percent: number): void {
  if (typeof document === "undefined") return;
  const progress = document.getElementById("build-progress");
  const phaseElement = document.getElementById("build-progress-phase");
  const percentElement = document.getElementById("build-progress-percent");
  const bar = document.getElementById("build-progress-bar") as HTMLProgressElement | null;
  if (progress) progress.hidden = false;
  if (phaseElement) phaseElement.textContent = phase;
  if (percentElement) percentElement.textContent = `${Math.round(percent)}%`;
  if (bar) bar.value = Math.max(0, Math.min(1, percent / 100));
}

interface PendingBuild {
  readonly resolve: (artifact: HydrologyGraphArtifact) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (buildPct: number) => void;
  readonly controller: AbortController;
}

export interface HydrologyGraphWorkerClient {
  available(): boolean;
  build(input: Omit<HydrologyGraphWorkerBuildRequest, "type" | "requestId" | "erodedMacroField" | "erosionArtifactRef">, onProgress?: (buildPct: number) => void): Promise<HydrologyGraphArtifact>;
  dispose(): void;
}

export function createHydrologyGraphWorkerClient(): HydrologyGraphWorkerClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./hydrology_graph_worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  let nextRequestId = 1;
  let terminalError: Error | null = null;
  let workerTerminated = false;
  const pending = new Map<number, PendingBuild>();

  const terminateWorker = (): void => {
    if (workerTerminated) return;
    workerTerminated = true;
    worker.terminate();
  };

  const failTerminally = (error: Error): void => {
    if (!terminalError) {
      terminalError = error;
      for (const request of pending.values()) {
        request.controller.abort(error);
        request.reject(error);
      }
      pending.clear();
    }
    terminateWorker();
  };

  worker.onmessage = (event: MessageEvent<HydrologyGraphWorkerResponse>) => {
    if (terminalError) return;
    const response = event.data;
    const request = pending.get(response.requestId);
    if (!request) return;
    if (response.type === "hydrologyGraphProgress") {
      const percent = 70 + response.buildPct * 0.3;
      try {
        request.onProgress?.(percent);
      } catch (error) {
        console.error("[hydrology] graph progress callback failed", error);
      }
      publishStartupPhase("Building watersheds", percent);
      return;
    }
    pending.delete(response.requestId);
    if (response.type === "hydrologyGraphError") {
      request.reject(new Error(response.message));
      return;
    }
    try {
      const erosion = response.artifact.graph.macro.erosion;
      if (erosion) {
        setActiveErodedMacroField(toErodedMacroField(erosion), response.artifact.graph.worldId);
        setLatestErosionArtifactRef(erosion.artifactRef, response.artifact.graph.worldId);
      } else {
        clearActiveErodedMacroField();
        setLatestErosionArtifactRef(null);
      }
      publishStartupPhase("Carving rivers and lakes", 100);
      request.resolve(response.artifact);
      queueMicrotask(() => publishStartupPhase("Preparing world tiles", 100));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  worker.onerror = (event) => {
    failTerminally(new Error(`hydrology graph worker crashed: ${event.message ?? "unknown error"}`));
  };
  worker.onmessageerror = () => {
    failTerminally(new Error("hydrology graph worker produced an unreadable message"));
  };

  return {
    available: () => terminalError === null,
    build(input, onProgress) {
      if (terminalError) return Promise.reject(terminalError);
      const requestId = nextRequestId++;
      const controller = new AbortController();
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, controller, ...(onProgress ? { onProgress } : {}) });
        publishStartupPhase("Generating base terrain", 0);
        void (async () => {
          const parsed = parseTerrainErosionConfig(terrainErosionConfigText);
          const searchParams = typeof location === "undefined" ? undefined : new URLSearchParams(location.search);
          const config = resolveRuntimeTerrainErosionConfig(parsed, searchParams);
          const configHash = await computeTerrainErosionConfigHash(config);
          const originM = input.originM ?? { x: 0, z: 0 };
          const sourceTerrainHash = await computeErosionSourceTerrainHash({
            generatorVersion: `${TERRAIN_SOURCE_VERSION}:terrain-erosion-source-v2`,
            worldId: input.worldId,
            seed: input.seed,
            sizeM: input.sizeM,
            originM,
            terrainFieldConfig: input.terrainFieldConfig,
          });
          const artifact = await buildCanonicalErosionArtifact({
            worldId: input.worldId,
            seed: input.seed,
            seaLevelM: input.terrainFieldConfig?.seaLevel ?? 18,
            sizeM: input.sizeM,
            originM,
            terrainFieldConfig: input.terrainFieldConfig,
            sourceTerrainHash,
            configHash,
            config,
            signal: controller.signal,
          }, (progress) => {
            const percent = progress.percent * 0.7;
            try {
              onProgress?.(percent);
            } catch (error) {
              console.error("[hydrology] erosion progress callback failed", error);
            }
            publishStartupPhase(progress.phase === "sampling" ? "Generating base terrain" : "Eroding terrain", percent);
          });
          if (terminalError || !pending.has(requestId)) return;
          publishStartupPhase("Building watersheds", 70);
          const erodedMacroField = cloneSerializedErodedMacroField(artifact.field);
          worker.postMessage({
            type: "buildHydrologyGraph",
            requestId,
            ...input,
            originM,
            erodedMacroField,
            erosionArtifactRef: artifact.ref,
          }, collectSerializedErosionTransferables(erodedMacroField));
        })().catch((error) => {
          const request = pending.get(requestId);
          if (!request) return;
          pending.delete(requestId);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    dispose() {
      failTerminally(new Error("hydrology graph worker disposed"));
    },
  };
}
