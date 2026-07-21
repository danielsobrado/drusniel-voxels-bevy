import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, "ground_debris_cpu_node_material.ts"), "utf8");

describe("WebGPU CPU debris TSL source", () => {
  it("uses world-space NodeMaterial masking with no classic shader hook", () => {
    expect(source).toContain("positionWorld.xz");
    expect(source).toContain("cameraPosition.x");
    expect(source).toContain("floor(positionWorld.xz.mul(WORLD_HASH_SCALE))");
    expect(source).toContain("material.maskNode = noise.lessThan(visibility)");
    expect(source).not.toContain("onBeforeCompile");
    expect(source).not.toContain("elapsedTime");
    expect(source).not.toContain("mapAsync");
  });
});
