import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./grass_startup.ts", import.meta.url), "utf8");

describe("grass dressing-contact startup", () => {
  it("registers the shared field before creating grass materials", () => {
    const ensureIndex = source.indexOf("ensureDressingGrassContactGpuResources(gpuBackend)");
    const controllerIndex = source.indexOf("createGrassController({");
    expect(ensureIndex).toBeGreaterThanOrEqual(0);
    expect(controllerIndex).toBeGreaterThan(ensureIndex);
  });

  it("does not require GPU dressing placement to register the consumer resource", () => {
    expect(source).toContain("if (isWebGpu && gpuBackend)");
    expect(source).not.toContain("dressingGpu");
  });
});
