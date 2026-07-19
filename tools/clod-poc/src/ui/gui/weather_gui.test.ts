import { describe, expect, it } from "vitest";
import { createWeatherGui } from "./weather_gui.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import type { SunbeamMoteRuntimeSettings } from "../../weather/sunbeam_mote_runtime.js";

interface AddCall {
  folder: string;
  prop: string;
  options: unknown;
}

function createFakeGui(addCalls: AddCall[], folders: string[]) {
  const controller = {
    name: () => controller,
    onChange: () => controller,
    disable: () => controller,
  };
  const makeFolder = (folderName: string): any => ({
    add: (_state: unknown, prop: string, options?: unknown) => {
      addCalls.push({ folder: folderName, prop, options });
      return controller;
    },
    addFolder: (name: string) => {
      folders.push(name);
      return makeFolder(name);
    },
  });
  return {
    addFolder: (name: string) => {
      folders.push(name);
      return makeFolder(name);
    },
  };
}

const moteSettings: SunbeamMoteRuntimeSettings = {
  enabled: true,
  strength: 1,
  visibilityStart: 0.45,
  visibilityEnd: 0.9,
  maxParticles: 1200,
  spawnRadiusM: 42,
  fadeStartM: 34,
  fadeEndM: 42,
  updatePeriodFrames: 8,
  density: 0.72,
  opacity: 0.82,
  forwardScatterPower: 8,
  mistFloor: 0.18,
  warmColorRgb: [0.85, 0.75, 0.45],
  coldColorRgb: [0.78, 0.9, 1],
};

describe("createWeatherGui", () => {
  it("adds wind and live sunbeam mote controls", () => {
    const addCalls: AddCall[] = [];
    const folders: string[] = [];
    const state = {
      weatherMode: "wind",
      weatherIntensity: 1,
      weatherWindX: 2,
      weatherWindZ: 0.4,
      weatherStats: "off",
    } as ClodAppState;
    const weatherController = {
      getSunbeamMoteSettings: () => ({ ...moteSettings }),
      setSunbeamMoteSettings: () => undefined,
      bindStatsController: () => undefined,
    };

    createWeatherGui(createFakeGui(addCalls, folders) as never, state, {
      weatherController: weatherController as never,
      applyWeatherSettings: () => undefined,
    });

    const modeCall = addCalls.find((call) => call.prop === "weatherMode");
    expect(modeCall?.options).toContain("wind");
    expect(folders).toContain("sunbeam motes");
    expect(addCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ folder: "sunbeam motes", prop: "enabled" }),
      expect.objectContaining({ folder: "sunbeam motes", prop: "density" }),
      expect.objectContaining({ folder: "sunbeam motes", prop: "forwardScatterPower" }),
    ]));
  });
});
