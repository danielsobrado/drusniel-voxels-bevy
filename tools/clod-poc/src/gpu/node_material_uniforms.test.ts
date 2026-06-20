import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// WGSL (WebGPU) has no `bool` uniform type: Three's WGSLNodeBuilder.getNodeUniform throws
// "Uniform 'bool' not declared" at shader-build time when a uniform() node is a boolean. Only the
// WebGL/GLSL backend tolerates it, so the failure is invisible to typecheck and to any test that
// can't spin up a GPU device. Toggles must instead be 0/1 numeric uniforms compared in-graph
// (e.g. `uniform(0).greaterThan(0.5)`). This source guard keeps a boolean literal from sneaking
// back into any *_node_material.ts uniform() call. See terrain_node_material.ts.
const gpuDir = dirname(fileURLToPath(import.meta.url));

function nodeMaterialFiles(): string[] {
  return readdirSync(gpuDir).filter((name) => name.endsWith("_node_material.ts"));
}

describe("WebGPU node-material uniforms", () => {
  it("never passes a boolean literal to uniform() (WGSL has no bool uniform)", () => {
    const offenders: string[] = [];
    for (const file of nodeMaterialFiles()) {
      const src = readFileSync(join(gpuDir, file), "utf8");
      const matches = src.matchAll(/\buniform\(\s*(true|false)\s*\)/g);
      for (const match of matches) offenders.push(`${file}: uniform(${match[1]})`);
    }
    expect(offenders, `boolean uniforms break the WGSL backend:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("finds the node-material modules it is meant to guard", () => {
    // Guard the guard: if these files move/rename the scan must not silently pass on zero files.
    expect(nodeMaterialFiles().length).toBeGreaterThan(0);
  });
});
