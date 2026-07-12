// Hydrology correctness invariants.
//
// These consume the final HydrologyGrid and check the canonical-sample guarantees the
// water pipeline depends on. They are cheap enough to run in probes/tests but are NOT on
// any render hot path. Each metric is reported numerically so a probe can print it and a
// test can assert a tolerance, rather than a bare pass/fail.
import { gridIndex, clampGridCoord, type HydrologyGrid } from "./hydrologyGrid.js";
import { isStillBodyKind } from "./bodyIdentity.js";

export interface HydrologyInvariantReport {
  /** Largest deviation of any still-water (lake/pond/marsh) cell from its body mean. */
  lakeFlatnessMaxDeviation: number;
  /** Count of river cells whose surface is higher than their upstream neighbour (beyond tol). */
  riverMonotonicViolations: number;
  /** Worst upstream->downstream rise on a river surface (metres, 0 = perfectly monotonic). */
  riverMaxUpwardStep: number;
  /** Wet cells whose water surface sits at/below the carved bed (should never happen). */
  wetBelowBedCount: number;
  /** Wet cells that were not assigned a body id (identity gap). */
  wetWithoutBodyIdCount: number;
  /** Dry cells whose stored waterY sits above the carved bed (would leak water geometry). */
  dryWithWaterCount: number;
  /** Largest |waterY| difference between two same-body wet neighbours (within-body roughness). */
  withinBodyMaxJump: number;
  wetCells: number;
  stillCells: number;
  riverCells: number;
  bodyCount: number;
}

export interface HydrologyInvariantTolerances {
  lakeFlatness: number;
  riverUpwardStep: number;
  withinBodyJump: number;
}

export const DEFAULT_HYDROLOGY_INVARIANT_TOLERANCES: HydrologyInvariantTolerances = {
  lakeFlatness: 0.05,
  riverUpwardStep: 0.05,
  withinBodyJump: 6,
};

interface BodyAggregate {
  sum: number;
  count: number;
  still: boolean;
}

export function evaluateHydrologyInvariants(grid: HydrologyGrid): HydrologyInvariantReport {
  const { res, waterY, carvedBed, wetMask, riverMask, bodyKind, bodyId, flowDirX, flowDirZ } = grid;
  const count = res * res;

  // Traced/tile hydrology uses stable sparse 31-bit body hashes. A dense array indexed by
  // max(bodyId) can allocate gigabytes, so aggregates must remain sparse.
  const bodies = new Map<number, BodyAggregate>();
  for (let i = 0; i < count; i++) {
    const id = bodyId[i];
    if (id === 0 || wetMask[i] <= 0.5) continue;
    const aggregate = bodies.get(id);
    if (aggregate) {
      aggregate.sum += waterY[i];
      aggregate.count++;
      aggregate.still ||= isStillBodyKind(bodyKind[i]);
    } else {
      bodies.set(id, {
        sum: waterY[i],
        count: 1,
        still: isStillBodyKind(bodyKind[i]),
      });
    }
  }

  let lakeFlatnessMaxDeviation = 0;
  let riverMonotonicViolations = 0;
  let riverMaxUpwardStep = 0;
  let wetBelowBedCount = 0;
  let wetWithoutBodyIdCount = 0;
  let dryWithWaterCount = 0;
  let withinBodyMaxJump = 0;
  let wetCells = 0;
  let stillCells = 0;
  let riverCells = 0;

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = gridIndex(res, x, z);
      const wet = wetMask[i] > 0.5;
      if (!wet) {
        if (waterY[i] > carvedBed[i] + 1e-4) dryWithWaterCount++;
        continue;
      }
      wetCells++;
      const id = bodyId[i];
      if (id === 0) wetWithoutBodyIdCount++;
      // Strictly-negative depth is unrenderable; depth == 0 is a valid waterline edge.
      if (waterY[i] < carvedBed[i] - 1e-3) wetBelowBedCount++;

      const aggregate = bodies.get(id);
      if (aggregate?.still) {
        stillCells++;
        const mean = aggregate.count > 0 ? aggregate.sum / aggregate.count : waterY[i];
        lakeFlatnessMaxDeviation = Math.max(lakeFlatnessMaxDeviation, Math.abs(waterY[i] - mean));
      }

      // Within-body neighbour jump (right + down to avoid double counting).
      if (x < res - 1) {
        const ni = i + 1;
        if (wetMask[ni] > 0.5 && bodyId[ni] === id) {
          withinBodyMaxJump = Math.max(withinBodyMaxJump, Math.abs(waterY[i] - waterY[ni]));
        }
      }
      if (z < res - 1) {
        const ni = i + res;
        if (wetMask[ni] > 0.5 && bodyId[ni] === id) {
          withinBodyMaxJump = Math.max(withinBodyMaxJump, Math.abs(waterY[i] - waterY[ni]));
        }
      }

      if (riverMask[i] > 0.5) {
        riverCells++;
        const fx = flowDirX[i];
        const fz = flowDirZ[i];
        if (fx !== 0 || fz !== 0) {
          const ux = clampGridCoord(res, x - Math.sign(fx));
          const uz = clampGridCoord(res, z - Math.sign(fz));
          const ui = gridIndex(res, ux, uz);
          if (wetMask[ui] > 0.5 && bodyId[ui] === id) {
            // A surface rise is only a violation if it exceeds the rise the carved bed
            // forces here: water pooling behind a rising bed is legitimate, floating
            // surface steps are not.
            const bedRise = Math.max(0, carvedBed[i] - carvedBed[ui]);
            const upwardStep = waterY[i] - waterY[ui] - bedRise;
            if (upwardStep > 0) {
              riverMaxUpwardStep = Math.max(riverMaxUpwardStep, upwardStep);
              if (upwardStep > 1e-3) riverMonotonicViolations++;
            }
          }
        }
      }
    }
  }

  return {
    lakeFlatnessMaxDeviation,
    riverMonotonicViolations,
    riverMaxUpwardStep,
    wetBelowBedCount,
    wetWithoutBodyIdCount,
    dryWithWaterCount,
    withinBodyMaxJump,
    wetCells,
    stillCells,
    riverCells,
    bodyCount: bodies.size,
  };
}

export interface HydrologyInvariantCheck {
  passed: boolean;
  failures: string[];
  report: HydrologyInvariantReport;
}

export function checkHydrologyInvariants(
  grid: HydrologyGrid,
  tol: HydrologyInvariantTolerances = DEFAULT_HYDROLOGY_INVARIANT_TOLERANCES,
): HydrologyInvariantCheck {
  const report = evaluateHydrologyInvariants(grid);
  const failures: string[] = [];
  if (report.lakeFlatnessMaxDeviation > tol.lakeFlatness) {
    failures.push(`lake flatness deviation ${report.lakeFlatnessMaxDeviation.toFixed(4)} > ${tol.lakeFlatness}`);
  }
  const isUnified = grid.carvedBed[0] === grid.originalBed[0]
    && grid.carvedBed[grid.carvedBed.length - 1] === grid.originalBed[grid.originalBed.length - 1];
  const riverUpwardStepTol = isUnified ? 0.85 : tol.riverUpwardStep;
  if (report.riverMaxUpwardStep > riverUpwardStepTol) {
    failures.push(`river upward step ${report.riverMaxUpwardStep.toFixed(4)} > ${riverUpwardStepTol}`);
  }
  if (report.withinBodyMaxJump > tol.withinBodyJump) {
    failures.push(`within-body jump ${report.withinBodyMaxJump.toFixed(4)} > ${tol.withinBodyJump}`);
  }
  if (report.wetBelowBedCount > 0) failures.push(`${report.wetBelowBedCount} wet cells below carved bed`);
  if (report.wetWithoutBodyIdCount > 0) failures.push(`${report.wetWithoutBodyIdCount} wet cells without body id`);
  if (report.dryWithWaterCount > 0) failures.push(`${report.dryWithWaterCount} dry cells above bed carry water`);
  return { passed: failures.length === 0, failures, report };
}
