import { createErosionArtifact } from "./artifact_codec.js";
import { createErosionCheckpoint, restoreErosionCheckpoint } from "./checkpoint.js";
import { erodeOrDeposit } from "./erode_deposit.js";
import { updateHydraulicFlux } from "./flux.js";
import { injectRain } from "./rain.js";
import { advectSediment } from "./sediment_advection.js";
import { computeSedimentCapacity } from "./sediment_capacity.js";
import {
  assertCanonicalScale,
  createErosionState,
  cropErodedMacroField,
  resolveErosionConstants,
  sampleErosionSourceField,
} from "./state.js";
import { relaxThermalTalus } from "./thermal_relaxation.js";
import type { ErosionArtifact, ErosionBuildInput, ErosionBuildProgress, ErosionCheckpoint, ErosionState } from "./types.js";
import { evaporateAndDrainBoundaries, updateWaterAndVelocity } from "./water.js";

const HYDRAULIC_STAGES = 10;
const HEIGHT_TO_SEDIMENT_SCALE = 256;

export interface BuildErosionCpuOptions {
  readonly seaLevelM: number;
  readonly onProgress?: (progress: ErosionBuildProgress) => void;
  readonly onCheckpoint?: (checkpoint: ErosionCheckpoint) => void | Promise<void>;
  readonly yieldBetweenCheckpoints?: () => Promise<void>;
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Erosion build cancelled", "AbortError");
}

function stateMassUnits(state: ErosionState): number {
  let total = 0;
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * state.width + x;
      total += state.heightFixed[index]! * HEIGHT_TO_SEDIMENT_SCALE + state.sediment[index]!;
    }
  }
  if (!Number.isSafeInteger(total)) throw new Error("erosion mass exceeds deterministic JavaScript integer range");
  return total;
}

function sourceMassUnits(state: ErosionState): number {
  let total = 0;
  const startX = state.borderCells;
  const endX = state.width - state.borderCells;
  const startZ = state.borderCells;
  const endZ = state.height - state.borderCells;
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const index = z * state.width + x;
      total += state.heightFixed[index]! * HEIGHT_TO_SEDIMENT_SCALE - state.deposition[index]!;
    }
  }
  if (!Number.isSafeInteger(total)) throw new Error("erosion source mass exceeds deterministic JavaScript integer range");
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
): Promise<ErosionArtifact> {
  assertCanonicalScale(input.config);
  assertNotCancelled(input.signal);
  const startedAt = performance.now();
  const constants = resolveErosionConstants(input.config);
  const state = input.checkpoint
    ? restoreErosionCheckpoint(input.checkpoint, input.sourceTerrainHash, input.configHash)
    : createErosionState(sampleErosionSourceField({
        sizeM: input.sizeM,
        originM: input.originM,
        config: input.config,
        sampleHeightMeters: input.sampleHeightMeters,
        seed: input.seed,
        seaLevelM: options.seaLevelM,
      }), input.config.erosion.borderCells);
  const initialMass = sourceMassUnits(state);
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
    assertNotCancelled(input.signal);
    await options.yieldBetweenCheckpoints?.();
  };

  while (state.hydraulicIteration < hydraulicTarget) {
    assertNotCancelled(input.signal);
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
    assertNotCancelled(input.signal);
    relaxThermalTalus(state, constants);
    if (state.thermalIteration % input.config.erosion.checkpointEveryIterations === 0) await checkpoint();
  }

  report("encoding");
  const finalMass = stateMassUnits(state);
  const massErrorRatio = Math.abs(finalMass - initialMass) / Math.max(1, Math.abs(initialMass));
  const artifact = await createErosionArtifact({
    field: cropErodedMacroField(state),
    sourceTerrainHash: input.sourceTerrainHash,
    configHash: input.configHash,
    buildMs: performance.now() - startedAt,
    checkpointCount,
    massErrorRatio,
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
