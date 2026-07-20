import { afterEach, describe, expect, it } from "vitest";
import configText from "../../../../config/probe_gi.yaml?raw";
import { createProbeGiCascadeState } from "../cascade_layout.js";
import { probeGiOriginForCamera } from "../clipmap_origin.js";
import { parseProbeGiConfig } from "../config.js";
import { createProbeGiGpuResources } from "./resources.js";

const gpuGlobals = globalThis as typeof globalThis & { GPUBufferUsage?: typeof GPUBufferUsage };
const originalUsage = gpuGlobals.GPUBufferUsage;

afterEach(() => {
  Object.defineProperty(gpuGlobals, "GPUBufferUsage", { value: originalUsage, configurable: true });
});

describe("probe GI GPU resources", () => {
  it("creates storage buffers and uploads only the eight records in one column", () => {
    Object.defineProperty(gpuGlobals, "GPUBufferUsage", {
      value: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 },
      configurable: true,
    });
    const writes: Array<{ offset: number; size: number }> = [];
    const destroyed: boolean[] = [];
    const device = {
      createBuffer: ({ size }: { size: number }) => ({ size, destroy: () => destroyed.push(true) }),
      queue: {
        writeBuffer: (_buffer: unknown, offset: number, _data: ArrayBuffer, _dataOffset: number, size: number) => {
          writes.push({ offset, size });
        },
      },
    } as unknown as GPUDevice;
    const config = parseProbeGiConfig(configText);
    const cascade = createProbeGiCascadeState(config.cascades[0], probeGiOriginForCamera(0, 0, config.cascades[0]));
    const resources = createProbeGiGpuResources(device, [cascade]);
    expect(resources?.byteSize).toBe(8192 * 96);
    resources?.uploadColumn(cascade, 0, 0);
    expect(writes).toHaveLength(8);
    expect(writes.every((write) => write.size === 96)).toBe(true);
    resources?.dispose();
    expect(destroyed).toHaveLength(1);
  });
});
