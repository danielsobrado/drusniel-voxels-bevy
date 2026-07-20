import type { HydrologySystem } from "../../water/index.js";
import { surfaceNormal, terrainWeights } from "../../terrain/terrain.js";
import { sampleActiveForestCanopyEcology } from "../../forest_lighting/forest_lighting_texture.js";
import { treePcg2d01 } from "../../vegetation/gpu_authority/pcg2d.js";
import type { DressingDiagnostics } from "./diagnostics.js";
import {
  DressingSystem as DressingSystemBase,
  type DressingSystemOptions,
} from "./dressing_system_base.js";
import { resolveDressingCanopyEcology } from "./dressing_canopy_environment.js";
import type { DressingEnvironmentSample } from "./types.js";

export type { DressingSystemOptions } from "./dressing_system_base.js";

interface DressingSystemPublic {
  update(center: { readonly x: number; readonly z: number }): void;
  getStats(): DressingDiagnostics;
  readonly enabled: boolean;
  dispose(): void;
}

interface DressingSystemInternals {
  rebuild(centerX: number, centerZ: number): void;
  surfaceHeightAt(x: number, z: number): number;
  surfaceNormalAt(x: number, z: number): [number, number, number];
  sampleBankFlow(
    x: number,
    z: number,
    center: ReturnType<HydrologySystem["sample"]> | undefined,
  ): readonly [number, number] | undefined;
}

interface LegacyEnvironmentSampler {
  sampleEnvironment(x: number, z: number): DressingEnvironmentSample;
}

const ExtensibleDressingSystemBase = DressingSystemBase as unknown as new (
  options: DressingSystemOptions,
) => DressingSystemPublic;

const legacyEnvironmentSampler = DressingSystemBase.prototype as unknown as LegacyEnvironmentSampler;

export class DressingSystem extends ExtensibleDressingSystemBase {
  private canonicalOptions: DressingSystemOptions | null = null;

  constructor(options: DressingSystemOptions) {
    const deferredConfig = { ...options.config, enabled: false };
    const deferredOptions = { ...options, config: deferredConfig };
    super(deferredOptions);
    deferredConfig.enabled = options.config.enabled;
    this.canonicalOptions = options;
    if (options.config.enabled) {
      const center = options.unboundedWorld
        ? { x: 0, z: 0 }
        : { x: options.worldCells * 0.5, z: options.worldCells * 0.5 };
      (this as unknown as DressingSystemInternals).rebuild(center.x, center.z);
    }
  }

  private sampleEnvironment(x: number, z: number): DressingEnvironmentSample {
    const options = this.canonicalOptions;
    if (!options) return legacyEnvironmentSampler.sampleEnvironment.call(this, x, z);

    const helpers = this as unknown as DressingSystemInternals;
    const hydrology = options.hydrologySystem?.sample(x, z, 4);
    const height = hydrology?.terrainY ?? helpers.surfaceHeightAt(x, z);
    const normal = options.hydrologySystem
      ? helpers.surfaceNormalAt(x, z)
      : surfaceNormal(x, z);
    const materials = terrainWeights(height, normal[1]);
    const forestNoise = treePcg2d01(
      Math.floor(x / 32),
      Math.floor(z / 32),
      options.worldSeed + 0x4401,
    )[0];
    const fallbackForest = smoothstep(0.28, 0.78, forestNoise);
    const ecology = resolveDressingCanopyEcology(
      sampleActiveForestCanopyEcology(x, z),
      {
        forest: fallbackForest,
        forestEdge: 1 - Math.min(1, Math.abs(forestNoise - 0.53) / 0.25),
        snowWeight: materials[3],
      },
    );
    const bankFlow = options.hydrologySystem
      ? helpers.sampleBankFlow(x, z, hydrology)
      : undefined;

    return {
      bankFlow,
      position: [x, height, z],
      normal,
      materialWeights: materials,
      waterDepthM: hydrology?.depth ?? 0,
      shoreDistanceM: hydrology?.shoreDistance ?? 999,
      flow: [hydrology?.flowX ?? 0, hydrology?.flowZ ?? 0],
      moisture: Math.max(ecology.moistureFloor, hydrology?.moisture ?? 0.35),
      wetness: Math.max(hydrology?.moisture ?? 0, hydrology?.depth ? 1 : 0),
      canopyBroadleaf: ecology.broadleafCoverage,
      canopyConifer: ecology.coniferCoverage,
      skyExposure: ecology.skyExposure,
      hardness: materials[1],
      sediment: materials[2] + (hydrology?.riverMask ?? 0) * 0.4,
      deposition: Math.max(0, 1 - (hydrology?.flowStrength ?? 0)),
      exactVoxelSurface: false,
      terrainEdited: false,
      structureExcluded: false,
      persistentExcluded: false,
      forestEdge: ecology.forestEdge,
      sunExposure: ecology.sunExposure,
      caveMouthFactor: 0,
    };
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
