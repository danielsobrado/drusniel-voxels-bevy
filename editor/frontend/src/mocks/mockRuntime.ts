import type { AgentObservation, AgentTimelineEvent, ConsoleMessage, RuntimeMetrics } from "../types/runtime";
import type { RenderQualityPreset } from "../types/editor";
import type { MockWaterRuntimeSnapshot, WaterPresence, WaterReflectionStatus, WaterVisualProbeOutput } from "../types/world";
import type { RenderQualityReadouts } from "../types/runtime";

const mockRenderQualityReadouts: Record<RenderQualityPreset, RenderQualityReadouts> = {
  Low: {
    propLodDistanceScale: 0.7,
    propShadowDistanceScale: 0.55,
    terrainMaterialLodDistance: 44,
    waterReflectionResolutionScale: 0.4,
    waterReflectionUpdateInterval: 2,
    waterReflectionDistance: 80,
    waterReflectionQualityCode: 1,
    shadowQualityCode: 1,
  },
  Medium: {
    propLodDistanceScale: 1,
    propShadowDistanceScale: 0.85,
    terrainMaterialLodDistance: 56,
    waterReflectionResolutionScale: 0.65,
    waterReflectionUpdateInterval: 1,
    waterReflectionDistance: 130,
    waterReflectionQualityCode: 3,
    shadowQualityCode: 2,
  },
  High: {
    propLodDistanceScale: 1.4,
    propShadowDistanceScale: 1,
    terrainMaterialLodDistance: 64,
    waterReflectionResolutionScale: 0.95,
    waterReflectionUpdateInterval: 0,
    waterReflectionDistance: 160,
    waterReflectionQualityCode: 5,
    shadowQualityCode: 3,
  },
  Performance100: {
    propLodDistanceScale: 1.8,
    propShadowDistanceScale: 1.3,
    terrainMaterialLodDistance: 76,
    waterReflectionResolutionScale: 1.2,
    waterReflectionUpdateInterval: 0,
    waterReflectionDistance: 220,
    waterReflectionQualityCode: 8,
    shadowQualityCode: 4,
  },
};

export const getMockRenderQualityReadouts = (preset: RenderQualityPreset): RenderQualityReadouts =>
  mockRenderQualityReadouts[preset];

export const mockRuntimeMetrics: RuntimeMetrics = {
  fps: 60,
  frameMs: 16.7,
  renderQualityPreset: "High",
  renderQualityReadouts: getMockRenderQualityReadouts("High"),
  chunkMeshMs: 2.4,
  waterReflectionMs: 1.1,
  propBillboardMs: 0.8,
  shadowBudget: {
    enabled: true,
  },
  ambientOcclusion: {
    gtaoEnabled: true,
    gtaoQuality: "medium",
    gtaoSliceCount: 18,
    gtaoStepsPerSlice: 8,
    gtaoRadius: 1.35,
    gtaoTemporalDenoise: true,
    ssaoSupported: true,
    ssaoEnabled: true,
    bakedAoStrength: 0.35,
  },
  adaptiveGI: {
    adaptiveGiQuality: 2,
    stochasticProbeSelection: true,
    probeSelectionCount: 6,
    sdfShadows: true,
    contactShadows: true,
  },
  waterRenderDebug: {
    reflectionActive: true,
    waterMaskPixels: 2142,
    displacementEnabled: true,
    visualProbeStatus: "cached",
  },
  lightingAtmosphere: {
    sunTimeOfDay: "morning",
    fogPreset: "Hazy",
    fogActive: true,
    godRaysEnabled: false,
    godRayIntensity: 0.6,
  },
  volumetricClouds: {
    coverage: 0.4,
    renderScale: 0.6,
    primarySteps: 12,
    lightSteps: 8,
  },
  cinematicPhotoMode: {
    photoModeActive: false,
    focalDistance: 120,
    aperture: 1.8,
    blurEnabled: true,
    depthOfFieldMode: "Bokeh",
    motionBlurSamples: 8,
    cinematicModeActive: false,
  },
  graphicsCapabilities: {
    adapterName: "Mock RTX Workstation",
    integratedGPU: false,
    taaSupported: true,
    rayTracingSupported: false,
    rayTracingEnabled: false,
  },
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
  activeMode: "select",
  activeTool: "select",
  selected: { kind: "chunk", id: "chunk-0-0", label: "Chunk 0,0" },
  visiblePanels: ["viewport", "world-outliner", "inspector", "asset-browser", "console", "profiler", "agent-workbench", "texture-atlas"],
  viewport: {
    cameraPosition: [84, 56, 112],
    targetVoxel: [80, 44, 112],
    overlays: ["chunkBounds", "voxelGrid", "protectedAreas", "waterDebug", "propBounds", "agentTargets"],
  },
  brush: {
    radius: 4,
    strength: 0.75,
    materialBlockId: "grass",
    falloff: "smooth",
    brushShape: "cube",
    targetFace: "all",
  },
  dirtyChunks: 3,
  warnings: ["South River reflection probe is stale.", "Mill Pond reflections are disabled."],
  suggestedCommands: [
    "editor.agent.observeScreen",
    "editor.agent.runPlan",
    "editor.agent.approveStep",
    "editor.agent.rejectStep",
    "editor.agent.revisePlan",
    "editor.agent.generatePlaywrightTest",
    "editor.agent.compareBeforeAfter",
    "editor.agent.saveSnapshot",
    "editor.agent.copyObservationJson",
  ],
};

export const mockAgentTimeline: readonly AgentTimelineEvent[] = [
  { id: "agent-event-1", kind: "observation", message: "Observed mocked world with 12 chunks and 40 props.", createdAt: "2026-05-04T00:00:00.000Z" },
  { id: "agent-event-2", kind: "warning", message: "Runtime integration unavailable by sprint scope.", createdAt: "2026-05-04T00:00:01.000Z" },
];
