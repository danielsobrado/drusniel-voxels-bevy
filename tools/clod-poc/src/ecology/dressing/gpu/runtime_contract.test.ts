import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systemSource = readFileSync(new URL("../dressing_system.ts", import.meta.url), "utf8");
const gpuSystemSource = readFileSync(new URL("./system.ts", import.meta.url), "utf8");
const shaderSource = readFileSync(new URL("./dressing.compute.wgsl", import.meta.url), "utf8");
const renderSource = readFileSync(new URL("./render_resources.ts", import.meta.url), "utf8");

describe("GPU dressing runtime contract", () => {
  it("uses GPU authority on WebGPU and keeps CPU generation only as a fallback", () => {
    expect(systemSource).toContain("new GpuDressingSystem");
    expect(systemSource).toContain("new CpuDressingSystem");
    expect(gpuSystemSource).not.toContain("sampleEnvironment");
    expect(gpuSystemSource).not.toContain("mapAsync");
    expect(gpuSystemSource).not.toContain("COPY_SRC");
  });

  it("owns candidate generation, acceptance, compaction, LOD and indirect drawing on GPU", () => {
    expect(shaderSource).toContain("fn dressing_environment_acceptance");
    expect(shaderSource).toContain("fn generate_and_compact");
    expect(shaderSource).toContain("fn generate_persistent");
    expect(shaderSource).toContain("fn generate_terrain");
    expect(shaderSource).toContain("fn dressing_lod");
    expect(shaderSource).toContain("atomicAdd(&counters[group]");
    expect(shaderSource).toContain("fn build_indirect_args");
    const bindings = readFileSync(new URL("../../../gpu/shaders/terrain_field_bindings_dressing.wgsl", import.meta.url), "utf8");
    expect(bindings).toContain("canonical_height_atlas");
    expect(shaderSource).toContain("canopy_detail_texture");
    expect(renderSource).toContain("setIndirect");
    expect(renderSource).toContain("StorageInstancedBufferAttribute");
  });
});
