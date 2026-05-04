import type { AgentObservation, AgentTimelineEvent, ConsoleMessage, RuntimeMetrics } from "../types/runtime";
import type { MockWaterRuntimeSnapshot, WaterPresence, WaterReflectionStatus, WaterVisualProbeOutput } from "../types/world";

export const mockRuntimeMetrics: RuntimeMetrics = {
  fps: 60,
  frameMs: 16.7,
  renderQualityPreset: "High",
  chunkMeshMs: 2.4,
  waterReflectionMs: 1.1,
  propBillboardMs: 0.8,
  timingSamples: [
    { label: "frame.total", ms: 16.7, category: "frame" },
    { label: "terrain.mesh.visible_chunks", ms: 2.4, category: "terrain" },
    { label: "water.reflection_probe", ms: 1.1, category: "water" },
    { label: "props.billboard_prepare", ms: 0.8, category: "props" },
  ],
};

export const mockConsoleMessages: readonly ConsoleMessage[] = [
  { id: "console-1", level: "info", message: "Editor shell booted with mocked runtime data.", time: "00:00:01" },
  { id: "console-2", level: "warning", message: "Runtime bridge is intentionally disabled for Sprint 2.", time: "00:00:03" },
];

export const mockWaterReflectionStatus: WaterReflectionStatus = {
  active: true,
  sampleReflection: true,
  reason: "active",
  resolutionScale: 0.5,
  effectiveHz: 60,
  enabled: true,
  debugViewMode: "Off",
  probeValid: true,
  lastProbeUpdateMs: 1.4,
};

export const mockWaterPresence: WaterPresence = {
  nearestWaterDistance: 12.5,
  visibleMeshes: 19,
  eligibleMeshes: 13,
  viewVisibleMeshes: 8,
  totalWaterMeshes: 27,
};

export const mockWaterProbeOutput: WaterVisualProbeOutput = {
  nearestBodyKind: "Lake",
  materialMode: "Fancy",
  maxDepth: 5,
  triangles: 1246,
  reflectionEligible: true,
  reflectionActive: true,
  compositorPixelMatched: true,
};

export const mockWaterRuntimeSnapshot: MockWaterRuntimeSnapshot = {
  reflectionStatus: mockWaterReflectionStatus,
  waterPresence: mockWaterPresence,
  probe: mockWaterProbeOutput,
};

export const mockAgentObservation: AgentObservation = {
  summary: "Agent can inspect typed store state, visible outliner nodes, command history, and mocked runtime warnings.",
  visiblePanels: ["Viewport", "World Outliner", "Inspector", "Asset Browser", "Console", "Profiler", "Agent Workbench"],
  selectedObjectLabel: "Chunk 0,0",
  runtimeWarnings: ["South River reflection probe is stale.", "Mill Pond reflections are disabled."],
};

export const mockAgentTimeline: readonly AgentTimelineEvent[] = [
  { id: "agent-event-1", kind: "observation", message: "Observed mocked world with 12 chunks and 40 props.", createdAt: "2026-05-04T00:00:00.000Z" },
  { id: "agent-event-2", kind: "warning", message: "Runtime integration unavailable by sprint scope.", createdAt: "2026-05-04T00:00:01.000Z" },
];
