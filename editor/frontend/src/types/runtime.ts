import type { RenderQualityPreset } from "./editor";

export interface RenderTimingSample {
  readonly label: string;
  readonly ms: number;
  readonly category: "terrain" | "water" | "props" | "frame" | "agent";
}

export interface RuntimeMetrics {
  readonly fps: number;
  readonly frameMs: number;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly chunkMeshMs: number;
  readonly waterReflectionMs: number;
  readonly propBillboardMs: number;
  readonly timingSamples: readonly RenderTimingSample[];
}

export interface ConsoleMessage {
  readonly id: string;
  readonly level: "info" | "warning" | "error";
  readonly message: string;
  readonly time: string;
}

export interface AgentObservation {
  readonly summary: string;
  readonly visiblePanels: readonly string[];
  readonly selectedObjectLabel?: string;
  readonly runtimeWarnings: readonly string[];
}

export interface AgentTimelineEvent {
  readonly id: string;
  readonly kind: "observation" | "command" | "warning";
  readonly message: string;
  readonly createdAt: string;
}
