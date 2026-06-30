import { describe, expect, it } from "vitest";
import { createWeatherGui } from "./weather_gui.js";
import type { ClodAppState } from "../../app/clod_app_state.js";

interface AddCall {
  prop: string;
  options: unknown;
}

function createFakeGui(addCalls: AddCall[]) {
  const controller = {
    name: () => controller,
    onChange: () => controller,
    disable: () => controller,
  };
  const folder = {
    add: (_state: unknown, prop: string, options?: unknown) => {
      addCalls.push({ prop, options });
      return controller;
    },
  };
  return {
    addFolder: () => folder,
  };
}

describe("createWeatherGui", () => {
  it("adds wind to the weather mode dropdown", () => {
    const addCalls: AddCall[] = [];
    const state = {
      weatherMode: "wind",
      weatherIntensity: 1,
      weatherWindX: 2,
      weatherWindZ: 0.4,
      weatherStats: "off",
    } as ClodAppState;
    const weatherController = {
      bindStatsController: () => undefined,
    };

    createWeatherGui(createFakeGui(addCalls) as never, state, {
      weatherController: weatherController as never,
      applyWeatherSettings: () => undefined,
    });

    const modeCall = addCalls.find((call) => call.prop === "weatherMode");
    expect(modeCall?.options).toContain("wind");
  });
});
