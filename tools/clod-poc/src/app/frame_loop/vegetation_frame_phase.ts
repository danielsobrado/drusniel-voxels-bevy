import { updateActiveProbeGiIntegration } from "../../lighting/probe_gi/index.js";
import {
  runVegetationFramePhase as runVegetationFramePhaseBase,
  type VegetationFramePhaseInput,
  type VegetationFrameTiming,
} from "./vegetation_frame_phase_base.js";

export type {
  VegetationFramePhaseInput,
  VegetationFrameTiming,
} from "./vegetation_frame_phase_base.js";

export function runVegetationFramePhase(input: VegetationFramePhaseInput): VegetationFrameTiming {
  const timing = runVegetationFramePhaseBase(input);
  updateActiveProbeGiIntegration(input.selectionFrameId);
  return timing;
}
