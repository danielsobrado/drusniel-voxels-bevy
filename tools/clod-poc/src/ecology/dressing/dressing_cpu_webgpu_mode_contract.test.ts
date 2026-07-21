import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return fs.readFileSync(path.join(directory, name), "utf8");
}

describe("CPU dressing WebGPU material routing", () => {
  it("preserves renderer identity before forcing CPU placement", () => {
    const integration = source("integration.ts");
    expect(integration).toContain("const useWebGpuMaterials = Boolean(options.gpuDevice && options.gpuBackend)");
    expect(integration).toContain("gpuDevice: forceCpu ? null : options.gpuDevice");
    expect(integration).toContain("useWebGpuMaterials,");
  });

  it("passes the material mode through both direct and runtime GPU fallbacks", () => {
    const system = source("dressing_system.ts");
    expect(system).toContain("readonly useWebGpuMaterials?: boolean");
    expect(system.match(/new CpuDressingSystem\(options\)/g)).toHaveLength(2);
  });

  it("does not use the classic onBeforeCompile hook in the WebGPU material", () => {
    const material = source("ground_debris_cpu_node_material.ts");
    expect(material).toContain("new MeshStandardNodeMaterial()");
    expect(material).toContain("material.maskNode = noise.lessThan(visibility)");
    expect(material).not.toContain("onBeforeCompile");
    expect(material).not.toContain("readBuffer");
    expect(material).not.toContain("mapAsync");
  });
});
