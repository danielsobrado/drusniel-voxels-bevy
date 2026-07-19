import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery } from "../../environment_query/types.js";
import { createEnvironmentQueryGui } from "./environment_query_gui.js";

interface AddCall {
  folder: string;
  target: Record<string, unknown>;
  prop: string;
  disabled: boolean;
  updateDisplay: ReturnType<typeof vi.fn>;
}

function createFakeGui(addCalls: AddCall[], folders: string[]) {
  return {
    addFolder: (folder: string) => {
      folders.push(folder);
      return {
        add: (target: Record<string, unknown>, prop: string) => {
          const call: AddCall = {
            folder,
            target,
            prop,
            disabled: false,
            updateDisplay: vi.fn(),
          };
          addCalls.push(call);
          const controller = {
            name: () => controller,
            onChange: () => controller,
            disable: () => {
              call.disabled = true;
              return controller;
            },
            updateDisplay: call.updateDisplay,
          };
          return controller;
        },
      };
    },
  };
}

function queryFixture(): EnvironmentQuery {
  const terrainMeta = { source: "live-terrain" as const, revision: 7, valid: true, cellSizeM: 16 };
  const hydrologyMeta = { source: "hydrology-cpu" as const, revision: 5, valid: true, cellSizeM: 16 };
  const visibilityMeta = { source: "sun-visibility-cache" as const, revision: 9, valid: true, cellSizeM: 16 };
  return {
    surfaceHeightBestEffort: vi.fn(() => ({ height: 20, meta: terrainMeta })),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 1, z: 0, meta: terrainMeta })),
    materialWeights: vi.fn(() => ({ grass: 0.5, rock: 0.25, sand: 0.25, snow: 0, meta: terrainMeta })),
    water: vi.fn(() => ({
      waterY: 21,
      carvedBedY: 20,
      depth: 1,
      wetMask: 1,
      shoreDistanceM: 2,
      bodyKind: 3,
      bodyId: 4,
      meta: hydrologyMeta,
    })),
    river: vi.fn(() => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.8,
      bedDrop: 0,
      rapidMask: 0.2,
      channelCenterWeight: 1,
      bankContactWeight: 0,
      gravelBarMask: 0.4,
      meta: hydrologyMeta,
    })),
    visibility: vi.fn(() => ({ sunVisibility: 0.3, meta: visibilityMeta })),
  };
}

describe("createEnvironmentQueryGui", () => {
  it("adds camera and coordinate actions with read-only ownership output", () => {
    const addCalls: AddCall[] = [];
    const folders: string[] = [];
    const query = queryFixture();

    createEnvironmentQueryGui(createFakeGui(addCalls, folders) as never, {
      getCameraPosition: () => ({ x: 12, z: 34 }),
      getQuery: () => query,
    });

    expect(folders).toEqual(["environment query probe"]);
    expect(addCalls.map((call) => call.prop)).toEqual([
      "x",
      "z",
      "hintM",
      "probeCoordinates",
      "probeCamera",
      "status",
      "surface",
      "normal",
      "material",
      "water",
      "river",
      "visibility",
      "values",
    ]);
    const readoutProps = ["status", "surface", "normal", "material", "water", "river", "visibility", "values"];
    expect(addCalls.filter((call) => readoutProps.includes(call.prop)).every((call) => call.disabled)).toBe(true);

    const cameraAction = addCalls.find((call) => call.prop === "probeCamera")!;
    (cameraAction.target.probeCamera as () => void)();

    expect(query.surfaceHeightBestEffort).toHaveBeenCalledWith(12, 34, 16);
    expect(addCalls.find((call) => call.prop === "status")?.target.status).toBe("sampled");
    expect(addCalls.find((call) => call.prop === "surface")?.target.surface).toContain("live-terrain | valid");
    expect(addCalls.find((call) => call.prop === "water")?.target.water).toContain("hydrology-cpu | valid");
    expect(addCalls.find((call) => call.prop === "visibility")?.target.visibility).toContain("sun-visibility-cache | valid");
  });

  it("reports missing active authority without sampling", () => {
    const addCalls: AddCall[] = [];
    createEnvironmentQueryGui(createFakeGui(addCalls, []) as never, {
      getCameraPosition: () => ({ x: 0, z: 0 }),
      getQuery: () => null,
    });

    const action = addCalls.find((call) => call.prop === "probeCoordinates")!;
    (action.target.probeCoordinates as () => void)();

    expect(addCalls.find((call) => call.prop === "status")?.target.status).toBe("no active query");
  });
});
