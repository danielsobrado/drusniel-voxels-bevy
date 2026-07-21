import { describe, expect, it, vi } from "vitest";
import type GUI from "lil-gui";
import { createCustomPropsGui } from "./custom_props_gui.js";

class FakeController {
  label = "";
  private handler: ((value: boolean) => void) | null = null;

  name(label: string): this {
    this.label = label;
    return this;
  }

  onChange(handler: (value: boolean) => void): this {
    this.handler = handler;
    return this;
  }

  emit(value: boolean): void {
    this.handler?.(value);
  }
}

describe("createCustomPropsGui", () => {
  it("creates a default-off GLB checkbox and forwards live changes", () => {
    const controller = new FakeController();
    const state: Record<string, boolean> = {};
    let folderName = "";
    const gui = {
      addFolder(name: string) {
        folderName = name;
        return {
          add(target: Record<string, boolean>, key: string) {
            state[key] = target[key] ?? false;
            return controller;
          },
        };
      },
    } as unknown as GUI;
    const setEnabled = vi.fn();

    createCustomPropsGui(gui, { initiallyEnabled: false, setEnabled });

    expect(folderName).toBe("custom props (GLB)");
    expect(state.enabled).toBe(false);
    expect(controller.label).toBe("enabled");

    controller.emit(true);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});
