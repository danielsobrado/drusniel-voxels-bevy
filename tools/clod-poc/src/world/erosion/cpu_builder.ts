import { createErosionArtifact } from "./artifact_codec.js";
import { assertErosionNotAborted, yieldErosionTask } from "./abort.js";
import { createErosionCheckpoint, restoreErosionCheckpoint } from "./checkpoint.js";
import { EROSION_ASYNC_ROWS_PER_YIELD } from "./constants.js";
import { erodeOrDeposit } from "./erode_deposit.js";
import { updateHydraulicFlux } from "./flux.js";
import { injectRain } from "./rain.js";
import { advectSediment } from "./sediment_advection.js";
import { computeSedimentCapacity } from "./sediment_capacity.js";
import {
  assertCanonicalScale,
  createErosionStateAsync,
  cropErodedMacroFieldAsync,
  resolveErosionConstants,
  sampleErosionSourceFieldAsync,
} from "./state.js";
import { relaxThermalTalus } from "./thermal_relaxation.js";
import type {
  ErosionBuildInput,
  ErosionBuildProgress,
  ErosionCpuCheckpoint,
  ErosionState,
  PersistedErosionArtifact,
} from "./types.js";
import { evaporateAndDrainBoundaries, updateWaterAndVelocity } from "./water.js";

const HYDRAULIC_STAGES = 10;
const HEIGHT_TO_SEDIMENT_SCALE = 256;

export interface BuildErosionCpuOptions {
  readonly seaLevelM: number;
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
  readonly onCheckpoint?: (checkpoint: ErosionCpuCheckpoint) => void | Promise<void>;
  readonly yieldBetweenCheckpoints?: () => Promise<void>;
}

async function stateMassUnits(state: ErosionState, source: boolean, signal?: AbortSignal): Promise<number> {
  let total = 0;
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  for (let z = startZ; z < endZ; z++) {
    assertErosionNotAborted(signal);
    for (let x = startX; x < endX; x++) {
      const index = z * state.width + x;
      total += source
        ? state.heightFixed[index]! * HEIGHT_TO_SEDIMENT_SCALE - state.deposition[index]!
        : state.heightFixed[index]! * HEIGHT_TO_SEDIMENT_SCALE + state.sediment[index]!;
    }
    if ((z - startZ + 1) % EROSION_ASYNC_ROWS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error(source
      ? "erosion source mass exceeds deterministic JavaScript integer range"
      : "erosion mass exceeds deterministic JavaScript integer range");
  }
  return total;
}

function buildPercent(state: ErosionState, input: ErosionBuildInput): number {
  const enabled = input.config.erosion.enabled;
  const hydraulicWork = (enabled ? input.config.erosion.hydraulicIterations : 0) * HYDRAULIC_STAGES;
  const thermalWork = enabled ? input.config.erosion.thermalIterations : 0;
  const completed = state.hydraulicIteration * HYDRAULIC_STAGES + state.thermalIteration;
  return hydraulicWork + thermalWork === 0 ? 100 : Math.min(99, completed / (hydraulicWork + thermalWork) * 100);
}

export async function buildErosionCpu(
  input: ErosionBuildInput,
  options: BuildErosionCpuOptions,
): Promise<PersistedErosionArtifact> {
  assertCanonicalScale(input.config);
  assertErosionNotAborted(input.signal);
  const startedAt = performance.now();
  const constants = resolveErosionConstants(input.config);
  let samplingMs = 0;
  let state: ErosionState;
  if (input.checkpoint) {
    state = restoreErosionCheckpoint(input.checkpoint, input.sourceTerrainHash, input.configHash);
  } else {
    const samplingStartedAt = performance.now();
    const source = await sampleErosionSourceFieldAsync({
      sizeM: input.sizeM,
      ...(input.originM ? { originM: input.originM } : {}),
      config: input.config,
      sampleHeightMeters: input.sampleHeightMeters,
      seed: input.seed,
      seaLevelM: options.seaLevelM,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    state = await createErosionStateAsync(source, input.config.erosion.borderCells, input.signal);
    samplingMs = performance.now() - samplingStartedAt;
  }
  const initialMass = await stateMassUnits(state, true, input.signal);
  const hydraulicTarget = input.config.erosion.enabled ? input.config.erosion.hydraulicIterations : 0;
  const thermalTarget = input.config.erosion.enabled ? input.config.erosion.thermalIterations : 0;
  let checkpointCount = 0;
  const report = (phase: ErosionBuildProgress["phase"]): void => options.onProgress?.({
    phase,
    hydraulicIteration: state.hydraulicIteration,
    thermalIteration: state.thermalIteration,
    percent: buildPercent(state, input),
    checkpointCount,
  });
  report(input.checkpoint ? "hydraulic" : "sampling");

  const checkpoint = async (): Promise<void> => {
    checkpointCount++;
    const saved = createErosionCheckpoint(state, input.sourceTerrainHash, input.configHash);
    await options.onCheckpoint?.(saved);
    report(state.hydraulicIteration < hydraulicTarget ? "hydraulic" : "thermal");
    if (options.yieldBetweenCheckpoints) await options.yieldBetweenCheckpoints();
    else await yieldErosionTask(input.signal);
    assertErosionNotAborted(input.signal);
  };

  while (state.hydraulicIteration < hydraulicTarget) {
    assertErosionNotAborted(input.signal);
    injectRain(state, constants, input.seed, state.hydraulicIteration);
    updateHydraulicFlux(state, constants);
    updateWaterAndVelocity(state, constants);
    computeSedimentCapacity(state, constants);
    erodeOrDeposit(state, constants);
    advectSediment(state);
    evaporateAndDrainBoundaries(state, constants);
    state.hydraulicIteration++;
    if (state.hydraulicIteration % 4 === 0 && state.thermalIteration < thermalTarget) {
      relaxThermalTalus(state, constants);
    }
    if (state.hydraulicIteration % input.config.erosion.checkpointEveryIterations === 0) await checkpoint();
  }

  while (state.thermalIteration < thermalTarget) {
    assertErosionNotAborted(input.signal);
    relaxThermalTalus(state, constants);
    if (state.thermalIteration % input.config.erosion.checkpointEveryIterations === 0) await checkpoint();
  }

  report("encoding");
  const finalMass = await stateMassUnits(state, false, input.signal);
  const massErrorRatio = Math.abs(finalMass - initialMass) / Math.max(1, Math.abs(initialMass));
  const field = await cropErodedMacroFieldAsync(state, input.signal);
  const artifact = await createErosionArtifact({
    field,
    sourceTerrainHash: input.sourceTerrainHash,
    configHash: input.configHash,
    buildMs: performance.now() - startedAt,
    samplingMs,
    checkpointCount,
    massErrorRatio,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  options.onProgress?.({
    phase: "complete",
    hydraulicIteration: state.hydraulicIteration,
    thermalIteration: state.thermalIteration,
    percent: 100,
    checkpointCount,
  });
  return artifact;
}
