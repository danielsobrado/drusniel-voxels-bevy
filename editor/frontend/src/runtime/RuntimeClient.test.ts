import { describe, expect, it } from "vitest";
import { BrowserRuntimeClient } from "./BrowserRuntimeClient";
import { MockRuntimeClient } from "./MockRuntimeClient";
import { runtimeCommandSuccess } from "./runtimeSchemas";
import { mockAtlasMapping } from "../mocks/mockWorld";

describe("runtime clients", () => {
  it("browser runtime client sends safe write commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          preset: "Low",
          metrics: {
            propLodDistanceScale: 0.72,
            propShadowDistanceScale: 0.7,
            terrainMaterialLodDistance: 62.4,
            waterReflectionResolutionScale: 0.25,
            waterReflectionUpdateInterval: 1 / 30,
            waterReflectionDistance: 80,
            waterReflectionQualityCode: 0,
            shadowQualityCode: 0,
          },
        });
      },
    });

    const result = await client.setRenderQuality("Low");

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: "runtime.setRenderQuality",
      payload: { preset: "Low" },
    });
  });

  it("browser runtime client sends protected area commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({ areaId: "area-1", deleted: true });
      },
    });

    const result = await client.deleteProtectedArea("area-1");

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.deleteProtectedArea",
      payload: { areaId: "area-1" },
    });
  });

  it("mock runtime client validates atlas write result shape", async () => {
    const client = new MockRuntimeClient();
    const result = await client.setAtlasMapping(mockAtlasMapping);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected mock atlas mapping result.");
    }
    expect(result.data.mapping.grass.top).toBe(mockAtlasMapping.grass.top);
    expect(result.data.dirty).toBe(true);
  });

  it("mock runtime client handles protected area validation and rule queries", async () => {
    const client = new MockRuntimeClient();
    const validation = await client.validateProtectedAreaConflicts();
    const query = await client.queryProtectedRulesAtVoxel([64, 24, 64]);

    expect(validation.ok).toBe(true);
    expect(query.ok).toBe(true);
  });
});
