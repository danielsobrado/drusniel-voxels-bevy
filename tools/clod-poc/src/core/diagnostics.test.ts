import { describe, expect, it } from "vitest";
import { buildRequiredLimits } from "./diagnostics.js";
import type { GpuDiagnostics } from "./hooks.js";

describe("WebGPU required limits", () => {
  it("requests the vertex capacity used by packed tree geometry", () => {
    const diagnostics: GpuDiagnostics = {
      ok: true,
      features: [],
      limits: {
        maxStorageBuffersPerShaderStage: 10,
        maxStorageTexturesPerShaderStage: 8,
        maxVertexBuffers: 31,
        maxVertexAttributes: 31,
      },
    };

    expect(buildRequiredLimits(diagnostics)).toEqual({
      maxStorageBuffersPerShaderStage: 10,
      maxStorageTexturesPerShaderStage: 4,
      maxVertexBuffers: 16,
      maxVertexAttributes: 31,
    });
  });

  it("never requests more than the adapter exposes", () => {
    const diagnostics: GpuDiagnostics = {
      ok: true,
      features: [],
      limits: {
        maxVertexBuffers: 8,
        maxVertexAttributes: 16,
      },
    };

    expect(buildRequiredLimits(diagnostics)).toEqual({
      maxVertexBuffers: 8,
      maxVertexAttributes: 16,
    });
  });

  it("requests enough storage binding capacity for a continent erosion checkpoint", () => {
    const diagnostics: GpuDiagnostics = {
      ok: true,
      features: [],
      limits: {
        maxStorageBufferBindingSize: 2_147_483_644,
        maxBufferSize: 2_147_483_644,
      },
    };

    expect(buildRequiredLimits(diagnostics)).toMatchObject({
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
    });
  });
});
