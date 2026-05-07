import type { BrushSettings, EditorMode, RenderQualityPreset, Selection } from "./editor";

export type GtaoQuality = "low" | "medium" | "high";
export type RenderFeatureFlag = "gtao" | "ssao" | "bakedAo" | "shadowBudget" | "rayTracing" | "fog" | "godRays";

export interface RenderQualityReadouts {
  readonly propLodDistanceScale: number;
  readonly propShadowDistanceScale: number;
  readonly terrainMaterialLodDistance: number;
  readonly waterReflectionResolutionScale: number;
  readonly waterReflectionUpdateInterval: number;
  readonly waterReflectionDistance: number;
  readonly waterReflectionQualityCode: number;
  readonly shadowQualityCode: number;
}

export interface AmbientOcclusionSettings {
  readonly gtaoEnabled: boolean;
  readonly gtaoQuality: GtaoQuality;
  readonly gtaoSliceCount: number;
  readonly gtaoStepsPerSlice: number;
  readonly gtaoRadius: number;
  readonly gtaoTemporalDenoise: boolean;
  readonly ssaoSupported: boolean;
  readonly ssaoEnabled: boolean;
  readonly bakedAoStrength: number;
}

export interface AdaptiveGISettings {
  readonly adaptiveGiQuality: number;
  readonly stochasticProbeSelection: boolean;
  readonly probeSelectionCount: number;
  readonly sdfShadows: boolean;
  readonly contactShadows: boolean;
}

export interface ShadowBudgetSettings {
  readonly enabled: boolean;
}

export interface WaterRenderDebugSettings {
  readonly reflectionActive: boolean;
  readonly waterMaskPixels: number;
  readonly displacementEnabled: boolean;
  readonly visualProbeStatus: string;
}

export interface LightingAtmosphereSettings {
  readonly sunTimeOfDay: string;
  readonly fogPreset: string;
  readonly fogActive: boolean;
  readonly godRaysEnabled: boolean;
  readonly godRayIntensity: number;
}

export interface VolumetricCloudSettings {
  readonly coverage: number;
  readonly renderScale: number;
  readonly primarySteps: number;
  readonly lightSteps: number;
}

export interface CinematicPhotoSettings {
  readonly photoModeActive: boolean;
  readonly focalDistance: number;
  readonly aperture: number;
  readonly blurEnabled: boolean;
  readonly depthOfFieldMode: string;
  readonly motionBlurSamples: number;
  readonly cinematicModeActive: boolean;
}

export interface GraphicsCapabilities {
  readonly adapterName: string;
  readonly integratedGPU: boolean;
  readonly taaSupported: boolean;
  readonly rayTracingSupported: boolean;
}

export interface RenderTimingSample {
  readonly label: string;
  readonly ms: number;
  readonly category: "terrain" | "water" | "props" | "frame" | "agent";
}

export interface RuntimeMetrics {
  readonly fps: number;
  readonly frameMs: number;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly renderQualityReadouts: RenderQualityReadouts;
  readonly chunkMeshMs: number;
  readonly waterReflectionMs: number;
  readonly propBillboardMs: number;
  readonly shadowBudget: ShadowBudgetSettings;
  readonly ambientOcclusion: AmbientOcclusionSettings;
  readonly adaptiveGI: AdaptiveGISettings;
  readonly waterRenderDebug: WaterRenderDebugSettings;
  readonly lightingAtmosphere: LightingAtmosphereSettings;
  readonly volumetricClouds: VolumetricCloudSettings;
  readonly cinematicPhotoMode: CinematicPhotoSettings;
  readonly graphicsCapabilities: GraphicsCapabilities;
  readonly timingSamples: readonly RenderTimingSample[];
}

export interface ConsoleMessage {
  readonly id: string;
  readonly level: "info" | "warning" | "error";
  readonly message: string;
  readonly time: string;
}

export interface AgentObservation {
  readonly activeMode: EditorMode;
  readonly activeTool: string;
  readonly selected: Selection | null;
  readonly visiblePanels: readonly string[];
  readonly viewport: {
    readonly cameraPosition: readonly [number, number, number];
    readonly targetVoxel?: readonly [number, number, number];
    readonly overlays: readonly string[];
  };
  readonly brush: BrushSettings;
  readonly dirtyChunks: number;
  readonly warnings: readonly string[];
  readonly suggestedCommands: readonly string[];
}

export interface AgentTimelineEvent {
  readonly id: string;
  readonly kind: "observation" | "command" | "warning";
  readonly message: string;
  readonly createdAt: string;
}
