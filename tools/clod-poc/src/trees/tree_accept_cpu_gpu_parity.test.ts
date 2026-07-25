import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { WATER_LEVEL } from "../terrain/terrain.js";
import { composeTreeRingShader } from "../gpu/wgsl_modules.js";
import { TREE_GPU_RING_CELL } from "../gpu/tree_ring_compute.js";
import {
  TREE_RING_COMPETITION_CELL_M,
  treeAcceptMask,
  treeForestCoverMask,
  treeLocalCompetitionMask,
  treeParentClumpMask,
  treeRingAcceptParams,
  treeShorelineDensityMask,
} from "./tree_ring_math.js";

// The GPU ring accepts a cell when `tree_hash(wc, 809) < tree_accept_mask(...)` (WGSL); the CPU
// oracle used by `gpu.debugValidateAgainstCpu` (tree_ring_validation_counts.ts) and by the CPU
// lighting proxies (tree_ring_lighting_proxies.ts) makes the same test against `treeAcceptMask`.
// The WGSL mask multiplied in three terms the CPU one did not implement -- forest cover,
// shoreline density and local competition -- so the CPU side systematically over-accepted and
// the validator could not be trusted. These lock the two mask formulas together.
//
// CEILING: this covers the deterministic terms only. The WGSL additionally multiplies
// `tree_hydrology_bank_density_mask` and hard-rejects via `tree_hydrology_reject_tree`, which
// read the hydrology texture; the CPU oracle has no hydrology sampler, so those stay GPU-only.
// Per-cell decisions are also NOT comparable: WGSL `tree_hash` is a sin/fract hash while the CPU
// validation hash is pcg2d, so only aggregate counts (what the validator compares) line up.

const params = treeRingAcceptParams(DEFAULT_TREE_SETTINGS);

function acceptMaskReturnExpression(shader: string): string {
  const marker = "fn tree_accept_mask(";
  const start = shader.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = shader.slice(start);
  const ret = body.indexOf("  return clamp(cfg.base_density");
  expect(ret).toBeGreaterThanOrEqual(0);
  return body.slice(ret, body.indexOf(";", ret));
}

describe("CPU/GPU tree acceptance-mask parity", () => {
  it("the composed shader multiplies exactly the terms the CPU mask implements", () => {
    const expression = acceptMaskReturnExpression(composeTreeRingShader());
    for (const term of [
      "cfg.base_density",
      "lower_height",
      "upper_height",
      "slope_mask",
      "material_mask",
      "clump_mask",
      "forest_cover",
      "shoreline_mask",
      "competition_mask",
    ]) {
      expect(expression).toContain(term);
    }
    // A new GPU-only factor here silently reintroduces the over-accept gap, so pin the count.
    expect(expression.split("*").length - 1).toBe(8);
  });

  it("uses the same local-competition cell size as the GPU ring", () => {
    expect(TREE_RING_COMPETITION_CELL_M).toBe(TREE_GPU_RING_CELL);
  });

  it("forest cover stays within the shader's clamp and thins out in clearings", () => {
    let sawThinned = false;
    for (let i = 0; i < 400; i++) {
      const cover = treeForestCoverMask(i * 37.5, i * 91.25, params);
      expect(cover).toBeGreaterThanOrEqual(0.18);
      expect(cover).toBeLessThanOrEqual(1);
      if (cover < 0.999) sawThinned = true;
    }
    expect(sawThinned).toBe(true);
  });

  it("shoreline density zeroes inside the water clearance and recovers on dry bank", () => {
    const atClearance = WATER_LEVEL + params.waterClearanceM;
    expect(treeShorelineDensityMask(atClearance, 1, params)).toBeLessThan(1e-9);
    expect(treeShorelineDensityMask(atClearance + 7.5, 1, params)).toBeGreaterThan(0.9);
    expect(treeShorelineDensityMask(atClearance + 7.5, 1, params)).toBeLessThanOrEqual(1.18);
  });

  it("local competition stays inside the shader's mix range", () => {
    let sawPressure = false;
    for (let i = 0; i < 400; i++) {
      const mask = treeLocalCompetitionMask(i * 3.4, i * 6.8, params);
      expect(mask).toBeLessThanOrEqual(1.05 + 1e-9);
      expect(mask).toBeGreaterThanOrEqual(0.72 - 1e-9);
      if (mask < 1.05 - 1e-9) sawPressure = true;
    }
    expect(sawPressure).toBe(true);
  });

  it("acceptance carries exactly the position-dependent masks the shader applies", () => {
    // At fixed height/normal every other factor is constant, so dividing the mask out must
    // leave the same constant at every position. A missing factor (the bug) or a surplus one
    // makes this ratio wander. Guards the regression in both directions.
    const height = WATER_LEVEL + 26;
    const normalY = 0.97;
    const ratios: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = i * 13.7;
      const z = i * 29.3;
      const accept = treeAcceptMask(height, normalY, x, z, params);
      expect(accept).toBeGreaterThanOrEqual(0);
      expect(accept).toBeLessThanOrEqual(1);
      const positional = treeParentClumpMask(x, z, params)
        * treeForestCoverMask(x, z, params)
        * treeLocalCompetitionMask(x, z, params)
        * treeShorelineDensityMask(height, normalY, params);
      if (accept >= 1 - 1e-9 || positional < 1e-6) continue; // clamped: ratio not recoverable
      ratios.push(accept / positional);
    }
    expect(ratios.length).toBeGreaterThan(50);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(ratios[0], 9);
  });
});
