import type * as THREE from "three";
import probeGiConfigText from "../../../config/probe_gi.yaml?raw";
import { createCanonicalProbeGiProviders } from "./canonical_providers.js";
import { isProbeGiDebugMode, parseProbeGiConfig } from "./config.js";
import { createProbeGiDebugVisualization, type ProbeGiDebugVisualization } from "./debug_visualization.js";
import { createProbeGiRuntime, type ProbeGiRuntime } from "./runtime.js";
import { validateProbeGiStartup } from "./validation.js";
import type { ProbeGiConfig, ProbeGiProviders } from "./types.js";

export interface ProbeGiIntegrationOptions {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly searchParams?: URLSearchParams;
  readonly providers?: ProbeGiProviders;
  readonly configText?: string;
  readonly device?: GPUDevice | null;
}

export interface ProbeGiIntegration {
  readonly config: ProbeGiConfig;
  readonly runtime: ProbeGiRuntime;
  update(frame: number): void;
  dispose(): void;
}

let activeIntegration: ProbeGiIntegration | null = null;

export function createProbeGiIntegration(options: ProbeGiIntegrationOptions): ProbeGiIntegration | null {
  const parsed = parseProbeGiConfig(options.configText ?? probeGiConfigText);
  const config = applyProbeGiQueryOverrides(parsed, options.searchParams);
  if (!config.enabled) {
    activeIntegration?.dispose();
    activeIntegration = null;
    return null;
  }

  const runtime = createProbeGiRuntime(
    config,
    options.providers ?? createCanonicalProbeGiProviders(),
    options.camera.position.x,
    options.camera.position.z,
    { device: options.device },
  );
  try {
    validateProbeGiStartup(config, runtime.diagnostics.probe_gi_storage_bytes);
  } catch (error) {
    runtime.dispose();
    throw error;
  }
  let debug: ProbeGiDebugVisualization | null = null;
  try {
    if (config.debug.enabled) debug = createProbeGiDebugVisualization(options.scene);
  } catch (error) {
    runtime.dispose();
    throw error;
  }
  let lastDebugUpdateFrame = Number.NEGATIVE_INFINITY;

  const integration: ProbeGiIntegration = {
    config,
    runtime,
    update(frame) {
      const changed = runtime.update(options.camera.position.x, options.camera.position.z, frame);
      runtime.publishFrameBoundary(frame);
      if (
        changed
        && debug
        && (runtime.diagnostics.probe_gi_new_slab_queue === 0 || frame - lastDebugUpdateFrame >= 30)
      ) {
        lastDebugUpdateFrame = frame;
        debug.update(runtime.cascades, config.debug.mode);
      }
    },
    dispose() {
      debug?.dispose();
      debug = null;
      runtime.dispose();
      if (activeIntegration === integration) activeIntegration = null;
    },
  };
  activeIntegration?.dispose();
  activeIntegration = integration;
  return integration;
}

export function updateActiveProbeGiIntegration(frame: number): void {
  activeIntegration?.update(frame);
}

export function readActiveProbeGiIntegration(): ProbeGiIntegration | null {
  return activeIntegration;
}

export function applyProbeGiQueryOverrides(
  config: ProbeGiConfig,
  searchParams: URLSearchParams | undefined,
): ProbeGiConfig {
  if (!searchParams) return config;
  const enabledValue = searchParams.get("probeGi");
  const debugMode = searchParams.get("probeGiDebug");
  const enabled = enabledValue === "1" || enabledValue === "true"
    ? true
    : enabledValue === "0" || enabledValue === "false"
      ? false
      : config.enabled;
  if (debugMode !== null && !isProbeGiDebugMode(debugMode)) {
    throw new Error(`invalid probeGiDebug mode: ${debugMode}`);
  }
  const debug = debugMode
    ? { ...config.debug, enabled: true, mode: debugMode }
    : config.debug;
  return { ...config, enabled, debug };
}
