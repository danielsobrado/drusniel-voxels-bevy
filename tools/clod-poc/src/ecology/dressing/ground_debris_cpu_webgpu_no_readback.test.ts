import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const files = [
  "ground_debris_cpu_node_material.ts",
  "ground_debris_cpu_resources.ts",
  "dressing_system_cpu.ts",
];

describe("WebGPU CPU ground-debris readback policy", () => {
  it("keeps the fallback upload-free and readback-free", () => {
    const source = files.map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("\n");
    expect(source).not.toContain("mapAsync");
    expect(source).not.toContain("getMappedRange");
    expect(source).not.toContain("copyBufferToBuffer");
    expect(source).not.toContain("readBuffer");
  });
});
