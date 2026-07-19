export type WaterFoamAcceptanceRenderer = "webgpu" | "webgl";

export interface WaterFoamRendererProfile {
  readonly renderer: WaterFoamAcceptanceRenderer;
  readonly outputSuffix: string | null;
  readonly query: Readonly<Record<string, string>>;
}

const PROFILES: Readonly<Record<WaterFoamAcceptanceRenderer, WaterFoamRendererProfile>> = Object.freeze({
  webgpu: Object.freeze({
    renderer: "webgpu",
    outputSuffix: null,
    query: Object.freeze({ renderer: "webgpu", webgpuSelection: "1" }),
  }),
  webgl: Object.freeze({
    renderer: "webgl",
    outputSuffix: "webgl",
    query: Object.freeze({ renderer: "webgl", webgpuSelection: "0" }),
  }),
});

export function parseWaterFoamAcceptanceRenderer(value: string): WaterFoamAcceptanceRenderer {
  const normalized = value.trim().toLowerCase();
  if (normalized === "webgpu" || normalized === "gpu") return "webgpu";
  if (normalized === "webgl" || normalized === "gl") return "webgl";
  throw new Error(`unsupported water foam renderer: ${value}`);
}

export function getWaterFoamRendererProfile(
  renderer: WaterFoamAcceptanceRenderer,
): WaterFoamRendererProfile {
  return PROFILES[renderer];
}

export function applyWaterFoamRendererProfile(
  sourceUrl: string,
  renderer: WaterFoamAcceptanceRenderer,
): string {
  const url = new URL(sourceUrl);
  for (const [key, value] of Object.entries(PROFILES[renderer].query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
