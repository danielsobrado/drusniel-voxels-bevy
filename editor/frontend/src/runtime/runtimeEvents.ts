import type { Selection } from "../types/editor";
import type { GraphicsCapabilities } from "../types/runtime";
import type { RuntimeAtlasMappingState, RuntimeChunkSummary, RuntimeConnectionState, RuntimeConsoleEvent, RuntimeRenderTimingSample, RuntimeSnapshot, RuntimeWaterReflectionState, RuntimeWaterVisualProbeResult } from "./runtimeSchemas";

export type RuntimeEventType =
  | "runtime.connected"
  | "runtime.disconnected"
  | "runtime.snapshot"
  | "runtime.selectionChanged"
  | "runtime.targetedVoxelChanged"
  | "runtime.chunkUpdated"
  | "runtime.dirtyChunksChanged"
  | "runtime.waterReflectionUpdated"
  | "runtime.waterVisualProbeResult"
  | "runtime.renderTimingUpdated"
  | "runtime.consoleEvent"
  | "runtime.graphicsCapabilitiesUpdated"
  | "runtime.atlasMappingUpdated";

interface RuntimeEventBase<TType extends RuntimeEventType, TPayload> {
  readonly type: TType;
  readonly payload: TPayload;
  readonly createdAt: string;
}

export type RuntimeConnectedEvent = RuntimeEventBase<"runtime.connected", { readonly state: Extract<RuntimeConnectionState, "mock" | "connected"> }>;
export type RuntimeDisconnectedEvent = RuntimeEventBase<"runtime.disconnected", { readonly state: Extract<RuntimeConnectionState, "disconnected" | "stale" | "error">; readonly reason?: string }>;
export type RuntimeSnapshotEvent = RuntimeEventBase<"runtime.snapshot", RuntimeSnapshot>;
export type RuntimeSelectionChangedEvent = RuntimeEventBase<"runtime.selectionChanged", { readonly selection: Selection | null }>;
export type RuntimeTargetedVoxelChangedEvent = RuntimeEventBase<"runtime.targetedVoxelChanged", { readonly position: readonly [number, number, number] | null }>;
export type RuntimeChunkUpdatedEvent = RuntimeEventBase<"runtime.chunkUpdated", { readonly chunk: RuntimeChunkSummary }>;
export type RuntimeDirtyChunksChangedEvent = RuntimeEventBase<"runtime.dirtyChunksChanged", { readonly chunkIds: readonly string[] }>;
export type RuntimeWaterReflectionUpdatedEvent = RuntimeEventBase<"runtime.waterReflectionUpdated", RuntimeWaterReflectionState>;
export type RuntimeWaterVisualProbeResultEvent = RuntimeEventBase<"runtime.waterVisualProbeResult", RuntimeWaterVisualProbeResult>;
export type RuntimeRenderTimingUpdatedEvent = RuntimeEventBase<"runtime.renderTimingUpdated", { readonly samples: readonly RuntimeRenderTimingSample[] }>;
export type RuntimeConsoleEventEvent = RuntimeEventBase<"runtime.consoleEvent", RuntimeConsoleEvent>;
export type RuntimeGraphicsCapabilitiesUpdatedEvent = RuntimeEventBase<"runtime.graphicsCapabilitiesUpdated", GraphicsCapabilities>;
export type RuntimeAtlasMappingUpdatedEvent = RuntimeEventBase<"runtime.atlasMappingUpdated", RuntimeAtlasMappingState>;

export type RuntimeEvent =
  | RuntimeConnectedEvent
  | RuntimeDisconnectedEvent
  | RuntimeSnapshotEvent
  | RuntimeSelectionChangedEvent
  | RuntimeTargetedVoxelChangedEvent
  | RuntimeChunkUpdatedEvent
  | RuntimeDirtyChunksChangedEvent
  | RuntimeWaterReflectionUpdatedEvent
  | RuntimeWaterVisualProbeResultEvent
  | RuntimeRenderTimingUpdatedEvent
  | RuntimeConsoleEventEvent
  | RuntimeGraphicsCapabilitiesUpdatedEvent
  | RuntimeAtlasMappingUpdatedEvent;

export type RuntimeEventHandler = (event: RuntimeEvent) => void;
