import type { GpuDiagnostics } from "./hooks.js";

const INTERESTING_LIMITS: readonly (keyof GPUSupportedLimits & string)[] = [
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxBindGroups",
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupsPerDimension",
  "maxComputeInvocationsPerWorkgroup",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesPerShaderStage",
  "maxSampledTexturesPerShaderStage",
  "maxUniformBuffersPerShaderStage",
];

export function buildRequiredLimits(diagnostics: GpuDiagnostics): Record<string, number> {
  const desired: Record<string, number> = {
    maxStorageBuffersPerShaderStage: 12,
    maxStorageTexturesPerShaderStage: 4,
  };
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(desired)) {
    const adapterMax = diagnostics.limits[key];
    if (adapterMax !== undefined) out[key] = Math.min(value, adapterMax);
  }
  return out;
}

export async function probeWebGPU(): Promise<GpuDiagnostics> {
  if (!("gpu" in navigator) || !navigator.gpu) {
    return {
      ok: false,
      reason: "navigator.gpu is missing; this browser does not expose WebGPU.",
      features: [],
      limits: {},
    };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    return {
      ok: false,
      reason: `requestAdapter threw: ${error instanceof Error ? error.message : String(error)}`,
      features: [],
      limits: {},
    };
  }
  if (!adapter) {
    return {
      ok: false,
      reason: "requestAdapter returned null; WebGPU is present but no adapter was available.",
      features: [],
      limits: {},
    };
  }

  const limits: Record<string, number> = {};
  for (const key of INTERESTING_LIMITS) {
    const value = adapter.limits[key];
    if (typeof value === "number") limits[key] = value;
  }
  const info = adapter.info;
  return {
    ok: true,
    vendor: info?.vendor ?? "unknown",
    architecture: info?.architecture ?? "unknown",
    device: info?.device ?? "unknown",
    description: info?.description ?? "",
    features: [...adapter.features].map(String).sort(),
    limits,
  };
}

let failShown = false;

export function failLoud(title: string, details: readonly string[]): void {
  const message = `${title}\n${details.join("\n")}`;
  if (window.__drusnielClod) window.__drusnielClod.error = message;
  console.error("[clod-poc] FATAL:", title, details);
  if (failShown) return;
  failShown = true;

  for (const id of ["clod-left-stack", "project-toolbar", "player-mode-bar", "terraform-menu", "build-progress"]) {
    document.getElementById(id)?.setAttribute("hidden", "");
  }

  const el = document.createElement("div");
  el.id = "clod-poc-fatal";
  el.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:99999",
    "background:#150d0d",
    "color:#ffc5c5",
    "font:13px/1.5 ui-monospace,Menlo,Consolas,monospace",
    "padding:42px",
    "white-space:pre-wrap",
    "overflow:auto",
  ].join(";");
  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.cssText = "font-size:24px;color:#ff6767;font-weight:700;margin-bottom:18px";
  const body = document.createElement("div");
  body.textContent = details.join("\n");
  el.append(heading, body);
  document.body.appendChild(el);
}

export function installGlobalErrorHooks(): void {
  window.addEventListener("error", (event) => {
    failLoud("Uncaught error", [
      String(event.message),
      event.filename ? `at ${event.filename}:${event.lineno}` : "",
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    failLoud("Unhandled rejection", [
      reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason),
    ]);
  });
}

export function describeDiagnostics(diagnostics: GpuDiagnostics): string[] {
  return [
    `adapter: ${diagnostics.vendor ?? "?"} / ${diagnostics.architecture ?? "?"} ${diagnostics.description ?? ""}`,
    `features: ${diagnostics.features.join(", ") || "none reported"}`,
    ...Object.entries(diagnostics.limits).map(([key, value]) => `  ${key} = ${value}`),
  ];
}
