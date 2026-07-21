import type {
  FoamImageMetrics,
  FoamLightingMetrics,
  FoamTemporalMetrics,
} from "./water-foam-visual-metrics.js";

export type WaterFoamReferenceSourceKind = "fable5-world-demo" | "drusniel-clod-poc";
export type WaterFoamReferenceSceneId = "rapid" | "smoothRiver" | "lakeShore";

export interface WaterFoamReferenceSource {
  readonly kind: WaterFoamReferenceSourceKind;
  readonly repository: string;
  readonly commit: string;
  readonly renderer: string;
  readonly capturedAt: string;
}

export interface WaterFoamReferenceFiles {
  readonly waterMaskSha256: string;
  readonly foamASha256: string;
  readonly foamBSha256?: string;
  readonly finalSha256?: string;
}

export interface WaterFoamReferenceScene {
  readonly width: number;
  readonly height: number;
  readonly image: FoamImageMetrics;
  readonly temporal?: FoamTemporalMetrics;
  readonly lighting?: FoamLightingMetrics;
  readonly files: WaterFoamReferenceFiles;
}

export interface WaterFoamReferenceManifest {
  readonly schemaVersion: 1;
  readonly source: WaterFoamReferenceSource;
  readonly scenes: {
    readonly rapid: WaterFoamReferenceScene;
    readonly smoothRiver: WaterFoamReferenceScene;
    readonly lakeShore: WaterFoamReferenceScene;
  };
}

export function assertWaterFoamReferenceManifest(
  value: unknown,
): asserts value is WaterFoamReferenceManifest {
  const root = requireRecord(value, "foam reference manifest");
  if (root.schemaVersion !== 1) throw new Error("foam reference manifest schemaVersion must equal 1");
  assertSource(root.source);
  const scenes = requireRecord(root.scenes, "foam reference scenes");
  const rapid = assertScene(scenes.rapid, "rapid");
  assertScene(scenes.smoothRiver, "smoothRiver");
  assertScene(scenes.lakeShore, "lakeShore");
  if (!rapid.temporal) throw new Error("rapid foam reference scene requires temporal metrics");
  if (!rapid.lighting) throw new Error("rapid foam reference scene requires lighting metrics");
  if (!rapid.files.foamBSha256) throw new Error("rapid foam reference scene requires foam-b evidence");
  if (!rapid.files.finalSha256) throw new Error("rapid foam reference scene requires final evidence");
}

function assertSource(value: unknown): void {
  const source = requireRecord(value, "foam reference source");
  if (source.kind !== "fable5-world-demo" && source.kind !== "drusniel-clod-poc") {
    throw new Error("foam reference source kind is unsupported");
  }
  assertNonEmptyString(source.repository, "foam reference source repository");
  assertNonEmptyString(source.renderer, "foam reference source renderer");
  if (typeof source.commit !== "string" || !/^[0-9a-f]{40}$/i.test(source.commit)) {
    throw new Error("foam reference source commit must be a 40-character Git SHA");
  }
  if (typeof source.capturedAt !== "string" || Number.isNaN(Date.parse(source.capturedAt))) {
    throw new Error("foam reference source capturedAt must be ISO-8601");
  }
}

function assertScene(value: unknown, label: WaterFoamReferenceSceneId): WaterFoamReferenceScene {
  const scene = requireRecord(value, `${label} foam reference scene`);
  assertPositiveInteger(scene.width, `${label} width`);
  assertPositiveInteger(scene.height, `${label} height`);
  assertImageMetrics(scene.image, `${label} image`);
  if (scene.temporal !== undefined) assertTemporalMetrics(scene.temporal, `${label} temporal`);
  if (scene.lighting !== undefined) assertLightingMetrics(scene.lighting, `${label} lighting`);
  assertFiles(scene.files, `${label} files`);
  return scene as unknown as WaterFoamReferenceScene;
}

function assertImageMetrics(value: unknown, label: string): void {
  const metrics = requireRecord(value, label);
  assertNonNegativeInteger(metrics.waterPixelCount, `${label}.waterPixelCount`);
  assertNonNegativeInteger(metrics.activePixelCount, `${label}.activePixelCount`);
  for (const key of [
    "meanCoverage",
    "activeFraction",
    "isolatedActiveFraction",
    "componentDensityPerK",
    "largestComponentFraction",
    "stripeAnisotropy",
  ] as const) assertNonNegativeFinite(metrics[key], `${label}.${key}`);
}

function assertTemporalMetrics(value: unknown, label: string): void {
  const metrics = requireRecord(value, label);
  assertNonNegativeInteger(metrics.comparedPixelCount, `${label}.comparedPixelCount`);
  assertNonNegativeFinite(metrics.meanAbsoluteDelta, `${label}.meanAbsoluteDelta`);
  assertNonNegativeFinite(metrics.binaryIou, `${label}.binaryIou`);
}

function assertLightingMetrics(value: unknown, label: string): void {
  const metrics = requireRecord(value, label);
  assertNonNegativeInteger(metrics.sampleCount, `${label}.sampleCount`);
  assertNonNegativeFinite(metrics.meanLuminance, `${label}.meanLuminance`);
  assertNonNegativeFinite(metrics.p95Luminance, `${label}.p95Luminance`);
  assertNonNegativeFinite(metrics.standardDeviation, `${label}.standardDeviation`);
}

function assertFiles(value: unknown, label: string): void {
  const files = requireRecord(value, label);
  assertSha256(files.waterMaskSha256, `${label}.waterMaskSha256`);
  assertSha256(files.foamASha256, `${label}.foamASha256`);
  if (files.foamBSha256 !== undefined) assertSha256(files.foamBSha256, `${label}.foamBSha256`);
  if (files.finalSha256 !== undefined) assertSha256(files.finalSha256, `${label}.finalSha256`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}

function assertSha256(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be SHA-256`);
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`);
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
}

function assertNonNegativeFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}
