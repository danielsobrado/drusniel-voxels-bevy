import dressingConfigText from "../../../config/ecological_dressing.yaml?raw";
import type * as THREE from "three";
import type { VegetationGpuBackend } from "../../runtime/vegetation/vegetation_gpu_backend.js";
import type { HydrologySystem } from "../../water/index.js";
import { parseDressingConfig, type DressingQuality } from "./config.js";
import { DressingSystem } from "./dressing_system.js";
import { validateDressingStartup } from "./validation.js";

export interface DressingIntegrationOptions {
  readonly scene: THREE.Scene;
  readonly worldCells: number;
  readonly worldSeed: number;
  readonly hydrologySystem?: HydrologySystem | null;
  readonly searchParams?: URLSearchParams;
  readonly unboundedWorld?: boolean;
  readonly enabled?: boolean;
  readonly gpuDevice?: GPUDevice | null;
  readonly gpuBackend?: VegetationGpuBackend | null;
}

function qualityFromQuery(searchParams: URLSearchParams | undefined): DressingQuality {
  const value = searchParams?.get("dressingQuality") ?? searchParams?.get("dressing_quality");
  return value === "ultra" || value === "perf" || value === "potato" ? value : "balanced";
}

export function createDressingIntegration(options: DressingIntegrationOptions): DressingSystem {
  const parsed = parseDressingConfig(dressingConfigText);
  const disabledByQuery = options.enabled === false || options.searchParams?.get("dressing") === "0";
  const forceCpu = options.searchParams?.get("dressingGpu") === "0";
  const config = disabledByQuery ? { ...parsed, enabled: false } : parsed;
  validateDressingStartup(config);
  return new DressingSystem({
    scene: options.scene,
    worldCells: options.worldCells,
    worldSeed: options.worldSeed,
    hydrologySystem: options.hydrologySystem,
    unboundedWorld: options.unboundedWorld,
    quality: qualityFromQuery(options.searchParams),
    config,
    gpuDevice: forceCpu ? null : options.gpuDevice,
    gpuBackend: forceCpu ? null : options.gpuBackend,
  });
}
