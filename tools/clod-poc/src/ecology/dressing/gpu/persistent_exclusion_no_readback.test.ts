import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./compute.ts", import.meta.url), "utf8");

describe("dressing exclusion upload path", () => {
  it("uses write-only uploads with no gameplay readback", () => {
    expect(computeSource).toContain("GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST");
    expect(computeSource).toContain("queue.writeBuffer");
    expect(computeSource).not.toMatch(/COPY_SRC|MAP_READ|mapAsync|getMappedRange/);
  });
});
