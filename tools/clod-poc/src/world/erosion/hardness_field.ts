import { loadLongViewMaterialsConfig } from "../../config/longViewMaterialsConfig.js";
import { classifyTerrainMaterial } from "../../terrainMaterial/terrainMaterialBands.js";
import { assertErosionNotAborted, yieldErosionTask } from "./abort.js";
import { EROSION_ASYNC_ROWS_PER_YIELD, HARDNESS_MAX } from "./constants.js";
import { hardness01ToU16, hashU32 } from "./fixed_point.js";

export interface HardnessFieldInput {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly seaLevelM: number;
  readonly seed: number;
  readonly heightFixed: Int32Array;
  readonly signal?: AbortSignal;
}

interface HardnessContext {
  readonly result: Uint16Array;
  readonly heightUnitsPerCell: number;
  readonly materialConfig: ReturnType<typeof loadLongViewMaterialsConfig>["terrain_bands"] & {
    readonly macro_variation: ReturnType<typeof loadLongViewMaterialsConfig>["macro_variation"];
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createContext(input: HardnessFieldInput): HardnessContext {
  const materialAuthority = loadLongViewMaterialsConfig();
  return {
    result: new Uint16Array(input.width * input.height),
    heightUnitsPerCell: Math.max(1, input.cellSizeM * 256),
    materialConfig: {
      ...materialAuthority.terrain_bands,
      macro_variation: { ...materialAuthority.macro_variation, enabled: false },
    },
  };
}

function fillRow(input: HardnessFieldInput, context: HardnessContext, z: number): void {
  for (let x = 0; x < input.width; x++) {
    const index = z * input.width + x;
    const center = input.heightFixed[index]!;
    const left = input.heightFixed[z * input.width + Math.max(0, x - 1)]!;
    const right = input.heightFixed[z * input.width + Math.min(input.width - 1, x + 1)]!;
    const up = input.heightFixed[Math.max(0, z - 1) * input.width + x]!;
    const down = input.heightFixed[Math.min(input.height - 1, z + 1) * input.width + x]!;
    const slope = Math.min(1, Math.max(Math.abs(right - left), Math.abs(down - up)) / (context.heightUnitsPerCell * 2));
    const curvature = Math.min(1, Math.max(0, center * 4 - left - right - up - down) / context.heightUnitsPerCell);
    const elevationM = center / 256;
    const worldX = input.originX + x * input.cellSizeM;
    const worldZ = input.originZ + z * input.cellSizeM;
    const material = classifyTerrainMaterial({
      worldX,
      worldZ,
      height: elevationM,
      slope,
      waterLevel: input.seaLevelM,
      config: context.materialConfig,
    });
    const materialHardness = material.weights.rock * 0.92
      + material.weights.snow * 0.70
      + material.weights.dirt * 0.40
      + material.weights.grass * 0.32
      + material.weights.sand * 0.18;
    const exposedBedrock = clamp01((slope - 0.18) / 0.55);
    const ridgeCore = clamp01(curvature * 1.8 + Math.max(0, elevationM - input.seaLevelM - 55) / 90);
    const valleyFill = clamp01((0.10 - slope) / 0.10) * clamp01((input.seaLevelM + 28 - elevationM) / 40);
    const weathering = ((hashU32(input.seed, x, z, 0x57454154) >>> 8) & 0xffff) / HARDNESS_MAX;
    const hardness = clamp01(
      materialHardness * 0.78
      + exposedBedrock * 0.14
      + ridgeCore * 0.16
      - valleyFill * 0.10
      - weathering * 0.04,
    );
    context.result[index] = hardness01ToU16(hardness);
  }
}

export function buildHardnessField(input: HardnessFieldInput): Uint16Array {
  const context = createContext(input);
  for (let z = 0; z < input.height; z++) {
    assertErosionNotAborted(input.signal);
    fillRow(input, context, z);
  }
  return context.result;
}

export async function buildHardnessFieldAsync(input: HardnessFieldInput): Promise<Uint16Array> {
  const context = createContext(input);
  for (let z = 0; z < input.height; z++) {
    assertErosionNotAborted(input.signal);
    fillRow(input, context, z);
    if ((z + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(input.signal);
  }
  return context.result;
}
