import { afterEach, describe, expect, it, vi } from "vitest";
import type GUI from "lil-gui";
import type { WaterEffectKey, WaterEffectsState } from "../../water/index.js";
import { addWaterEffectsGui } from "./water_effects_gui.js";

class FakeController {
  label = "";
  private change: ((value: boolean) => void) | null = null;
  constructor(readonly property: WaterEffectKey) {}
  name(label: string): this { this.label = label; return this; }
  onChange(change: (value: boolean) => void): this { this.change = change; return this; }
  trigger(value: boolean): void { this.change?.(value); }
}

class FakeFolder {
  readonly controllers: FakeController[] = [];
  add(_state: WaterEffectsState, property: WaterEffectKey): FakeController {
    const controller = new FakeController(property);
    this.controllers.push(controller);
    return controller;
  }
}

class FakeGui {
  folderName = "";
  readonly folder = new FakeFolder();
  addFolder(name: string): FakeFolder { this.folderName = name; return this.folder; }
}

afterEach(() => vi.unstubAllGlobals());

describe("water effects GUI", () => {
  it("registers the three live controls", () => {
    const gui = new FakeGui();
    addWaterEffectsGui(gui as unknown as GUI, {
      waterController: {
        getEffectsState: () => ({ glacialMurkiness: true, rockFlour: false, reflectionTiers: true }),
        setEffectEnabled: vi.fn(),
      },
      onVisualChanged: vi.fn(),
    });
    expect(gui.folderName).toBe("water / glacial effects");
    expect(gui.folder.controllers.map(({ property, label }) => [property, label])).toEqual([
      ["glacialMurkiness", "glacial murkiness"],
      ["rockFlour", "rock flour"],
      ["reflectionTiers", "reflection tiers"],
    ]);
  });

  it("updates runtime, URL, and visual snapshot once", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { href: "https://example.test/?glacialWater=1&seed=9" });
    vi.stubGlobal("history", { state: null, replaceState });
    const gui = new FakeGui();
    const setEffectEnabled = vi.fn();
    const onVisualChanged = vi.fn();
    addWaterEffectsGui(gui as unknown as GUI, {
      waterController: {
        getEffectsState: () => ({ glacialMurkiness: true, rockFlour: false, reflectionTiers: false }),
        setEffectEnabled,
      },
      onVisualChanged,
    });
    gui.folder.controllers[0]!.trigger(false);
    expect(setEffectEnabled).toHaveBeenCalledWith("glacialMurkiness", false);
    expect(onVisualChanged).toHaveBeenCalledOnce();
    const next = new URL(replaceState.mock.calls[0]![2]);
    expect(next.searchParams.get("waterGlacialMurkiness")).toBe("0");
    expect(next.searchParams.has("glacialWater")).toBe(false);
    expect(next.searchParams.get("seed")).toBe("9");
  });
});
