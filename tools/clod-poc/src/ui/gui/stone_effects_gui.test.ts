import { afterEach, describe, expect, it, vi } from "vitest";
import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { cloneEnvironmentalMaskSettings } from "../../environment_masks/environment_mask_config.js";
import { setEnvironmentalMaskSettings } from "../../environment_masks/environment_mask_runtime.js";
import {
  riverCobbleGpuEnabled,
  setRiverCobbleGpuEnabled,
} from "../../stones/river_cobble_runtime.js";
import { createStoneEffectsGui } from "./stone_effects_gui.js";

class FakeController {
  label = "";
  disabled = false;
  private change: ((value: boolean) => void) | null = null;

  name(label: string): this {
    this.label = label;
    return this;
  }

  onChange(change: (value: boolean) => void): this {
    this.change = change;
    return this;
  }

  disable(): this {
    this.disabled = true;
    return this;
  }

  trigger(value: boolean): void {
    this.change?.(value);
  }
}

class FakeFolder {
  readonly controller = new FakeController();
  target: Record<string, unknown> | null = null;
  property = "";

  add(target: Record<string, unknown>, property: string): FakeController {
    this.target = target;
    this.property = property;
    return this.controller;
  }
}

class FakeGui {
  folderName = "";
  readonly folder = new FakeFolder();

  addFolder(name: string): FakeFolder {
    this.folderName = name;
    return this.folder;
  }
}

afterEach(() => {
  setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings());
  setRiverCobbleGpuEnabled(null);
  vi.unstubAllGlobals();
});

describe("stone effects GUI", () => {
  it("maps every alias to one live underwater-cobble switch", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", {
      href: "https://example.test/?underwaterCobbles=1&seed=9",
      search: "?underwaterCobbles=1&seed=9",
    });
    vi.stubGlobal("history", { state: null, replaceState });
    const gui = new FakeGui();
    const state = { stoneRiverCobblesEnabled: false } as ClodAppState;
    const rebuild = vi.fn();
    const updateInfo = vi.fn();

    createStoneEffectsGui(gui as unknown as GUI, state, {
      stoneController: { rebuild },
      updateInfo,
    });

    expect(gui.folderName).toBe("stone effects");
    expect(gui.folder.property).toBe("stoneRiverCobblesEnabled");
    expect(gui.folder.controller.label).toBe("underwater river cobbles");
    expect(state.stoneRiverCobblesEnabled).toBe(true);

    gui.folder.controller.trigger(false);

    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(updateInfo).toHaveBeenCalledOnce();
    const next = new URL(replaceState.mock.calls[0]![2]);
    expect(next.searchParams.get("riverCobbles")).toBe("0");
    expect(next.searchParams.has("underwaterCobbles")).toBe(false);
    expect(next.searchParams.get("seed")).toBe("9");
  });

  it("disables the switch when the YAML mask is unavailable", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.riverCobble.enabled = false;
    setEnvironmentalMaskSettings(settings);
    const gui = new FakeGui();
    const state = { stoneRiverCobblesEnabled: true } as ClodAppState;

    createStoneEffectsGui(gui as unknown as GUI, state, {
      stoneController: { rebuild: vi.fn() },
      updateInfo: vi.fn(),
    });

    expect(state.stoneRiverCobblesEnabled).toBe(false);
    expect(gui.folder.controller.disabled).toBe(true);
  });
});
