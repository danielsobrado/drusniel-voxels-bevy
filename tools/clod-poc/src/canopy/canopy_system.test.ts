import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  canopyTextureConfigKey,
  shellCenterForTextureSet,
  shellGridForTriangleBudget,
  shouldAttemptTextureUpload,
  shouldKeepCanopyShellActive,
  shouldRebuildCanopyShell,
  shouldUseSyntheticCanopyFallback,
  treeDistributionConfigKey,
} from "./canopy_system.js";
import type { CanopyTextureSet } from "./canopy_types.js";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";

const textureSets: CanopyTextureSet[] = [];

afterEach(() => {
  for (const set of textureSets.splice(0)) {
    set.heightTexture.dispose();
    set.coverageTexture.dispose();
    set.speciesTexture.dispose();
    set.roughnessTexture.dispose();
  }
});

function mockTextureSet(
  revision: number,
  syntheticFallback = false,
  originX = 0,
  originZ = 0,
  extentM = 1024,
): CanopyTextureSet {
  const data = new Float32Array(4);
  const set = {
    heightTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    coverageTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    speciesTexture: new THREE.DataTexture(data, 2, 2, THREE.RGBFormat, THREE.FloatType),
    roughnessTexture: new THREE.DataTexture(data, 2, 2, THREE.RedFormat, THREE.FloatType),
    originX,
    originZ,
    extentM,
    resolution: 2,
    syntheticFallback,
    revision,
  };
  textureSets.push(set);
  return set;
}

function cloneConfig(): CanopyShellConfig {
  return structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
}

describe("shellGridForTriangleBudget", () => {
  it("caps grid from the configured triangle budget", () => {
    expect(shellGridForTriangleBudget(250000)).toBe(192);
    expect(shellGridForTriangleBudget(8000)).toBe(63);
    expect(shellGridForTriangleBudget(512)).toBe(16);
  });

  it("falls back safely for invalid runtime budgets", () => {
    expect(shellGridForTriangleBudget(0)).toBe(16);
    expect(shellGridForTriangleBudget(-1)).toBe(16);
    expect(shellGridForTriangleBudget(Number.NaN)).toBe(16);
    expect(shellGridForTriangleBudget(250000, Number.NaN)).toBe(192);
  });
});

describe("shouldAttemptTextureUpload", () => {
  it("returns true only while upload capacity remains", () => {
    expect(shouldAttemptTextureUpload(0, 0)).toBe(false);
    expect(shouldAttemptTextureUpload(1, 0)).toBe(true);
    expect(shouldAttemptTextureUpload(1, 1)).toBe(false);
    expect(shouldAttemptTextureUpload(2, 1)).toBe(true);
  });
});

describe("shouldUseSyntheticCanopyFallback", () => {
  it("uses automatic fallback only while clipmap is enabled and empty", () => {
    const config = cloneConfig();
    config.source.allowSyntheticDebugFallback = true;
    config.debug.forceSyntheticSource = false;
    config.clipmap.enabled = true;

    expect(shouldUseSyntheticCanopyFallback(config, false, 0)).toBe(true);
    expect(shouldUseSyntheticCanopyFallback(config, false, 1)).toBe(false);

    config.clipmap.enabled = false;
    expect(shouldUseSyntheticCanopyFallback(config, false, 0)).toBe(false);
  });

  it("allows explicit synthetic fallback even when clipmap is disabled", () => {
    const config = cloneConfig();
    config.clipmap.enabled = false;

    expect(shouldUseSyntheticCanopyFallback(config, true, 0)).toBe(true);

    config.debug.forceSyntheticSource = true;
    expect(shouldUseSyntheticCanopyFallback(config, false, 0)).toBe(true);
  });
});

describe("shouldKeepCanopyShellActive", () => {
  it("keeps the shell active while the clipmap is enabled", () => {
    const config = cloneConfig();
    config.clipmap.enabled = true;

    expect(shouldKeepCanopyShellActive(config, false)).toBe(true);
  });

  it("disables the shell when clipmap is disabled and synthetic mode is not forced", () => {
    const config = cloneConfig();
    config.clipmap.enabled = false;
    config.debug.forceSyntheticSource = false;

    expect(shouldKeepCanopyShellActive(config, false)).toBe(false);
  });

  it("keeps the shell active for explicit synthetic debug modes", () => {
    const config = cloneConfig();
    config.clipmap.enabled = false;

    expect(shouldKeepCanopyShellActive(config, true)).toBe(true);

    config.debug.forceSyntheticSource = true;
    expect(shouldKeepCanopyShellActive(config, false)).toBe(true);
  });
});

describe("canopy config invalidation keys", () => {
  it("changes the tree-distribution key when seed changes", () => {
    const a = cloneConfig();
    const b = cloneConfig();
    b.seed += 1;

    expect(treeDistributionConfigKey(a)).not.toBe(treeDistributionConfigKey(b));
  });

  it("changes the tree-distribution key when tree rules change", () => {
    const a = cloneConfig();
    const b = cloneConfig();
    b.treeDistribution.forestThreshold += 0.1;

    expect(treeDistributionConfigKey(a)).not.toBe(treeDistributionConfigKey(b));
  });

  it("changes the texture key when shell distance changes", () => {
    const a = cloneConfig();
    const b = cloneConfig();
    b.distances.shellEndM *= 2;

    expect(canopyTextureConfigKey(a)).not.toBe(canopyTextureConfigKey(b));
  });

  it("changes the texture key when material/debug texture inputs change", () => {
    const a = cloneConfig();
    const b = cloneConfig();
    b.material.coverageAlphaPower = 0.5;
    b.debug.showCoverageHeatmap = true;

    expect(canopyTextureConfigKey(a)).not.toBe(canopyTextureConfigKey(b));
  });
});

describe("shellCenterForTextureSet", () => {
  it("keeps shell placement coupled to texture origin", () => {
    const set = mockTextureSet(1, false, 100, 200, 800);

    expect(shellCenterForTextureSet(set)).toEqual({ x: 500, z: 600 });
  });
});

describe("shouldRebuildCanopyShell", () => {
  it("rebuilds when revision changes", () => {
    const prev = mockTextureSet(1);
    const next = mockTextureSet(2);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(true);
  });

  it("rebuilds when synthetic fallback mode changes", () => {
    const prev = mockTextureSet(1, false);
    const next = mockTextureSet(1, true);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(true);
  });

  it("skips rebuild when revision and mode are unchanged", () => {
    const prev = mockTextureSet(3);
    const next = mockTextureSet(3);
    expect(shouldRebuildCanopyShell(prev, next)).toBe(false);
  });

  it("always rebuilds from null previous set", () => {
    const next = mockTextureSet(1);
    expect(shouldRebuildCanopyShell(null, next)).toBe(true);
  });
});
