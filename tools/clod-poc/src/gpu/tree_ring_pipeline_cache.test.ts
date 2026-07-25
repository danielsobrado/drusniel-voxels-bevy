import { beforeAll, describe, expect, it, vi } from "vitest";
import { prewarmTreeGpuRingPipelines } from "./tree_ring_compute.js";

// GPUShaderStage is a browser global; the bind group layout is built with it outside any device.
beforeAll(() => {
  (globalThis as { GPUShaderStage?: unknown }).GPUShaderStage ??= { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 };
});

// The `tree_cull` entry point takes ~9s to compile in the browser (the other two take ~1.4s
// together), and the ring used to ask for it only on the first frame that updates trees -- so the
// scene sat on CPU-fallback patches (near/mid only, no impostors) for ~12s past the first frame.
// The fix prewarms the compile and memoises the result per device+workgroup size. If the cache
// stops holding, every ring rebuild re-pays 9s and the prewarm buys nothing.

interface FakeDevice {
  device: GPUDevice;
  pipelineCalls: () => number;
  moduleCalls: () => number;
}

function fakeDevice(compile: () => Promise<unknown> = () => Promise.resolve({})): FakeDevice {
  let pipelineCalls = 0;
  let moduleCalls = 0;
  const device = {
    createShaderModule: vi.fn(() => { moduleCalls++; return {}; }),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipelineAsync: vi.fn(() => { pipelineCalls++; return compile(); }),
  } as unknown as GPUDevice;
  return { device, pipelineCalls: () => pipelineCalls, moduleCalls: () => moduleCalls };
}

const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

describe("tree ring compute pipeline cache", () => {
  it("compiles the three entry points once and reuses them for the same workgroup size", async () => {
    const fake = fakeDevice();
    prewarmTreeGpuRingPipelines(fake.device, 64);
    expect(fake.pipelineCalls()).toBe(3);

    prewarmTreeGpuRingPipelines(fake.device, 64);
    prewarmTreeGpuRingPipelines(fake.device, 64);
    await settle();
    expect(fake.pipelineCalls()).toBe(3);
    expect(fake.moduleCalls()).toBe(1);
  });

  it("compiles separately per workgroup size", async () => {
    const fake = fakeDevice();
    prewarmTreeGpuRingPipelines(fake.device, 64);
    prewarmTreeGpuRingPipelines(fake.device, 128);
    await settle();
    expect(fake.pipelineCalls()).toBe(6);
  });

  it("caches per device, so a second device compiles its own set", async () => {
    const a = fakeDevice();
    const b = fakeDevice();
    prewarmTreeGpuRingPipelines(a.device, 64);
    prewarmTreeGpuRingPipelines(b.device, 64);
    await settle();
    expect(a.pipelineCalls()).toBe(3);
    expect(b.pipelineCalls()).toBe(3);
  });

  it("does not cache a failed compile, so the ring can recover", async () => {
    let fail = true;
    const fake = fakeDevice(() => (fail ? Promise.reject(new Error("compile failed")) : Promise.resolve({})));
    prewarmTreeGpuRingPipelines(fake.device, 64);
    await settle();
    expect(fake.pipelineCalls()).toBe(3);

    fail = false;
    prewarmTreeGpuRingPipelines(fake.device, 64);
    await settle();
    expect(fake.pipelineCalls()).toBe(6);
  });
});
