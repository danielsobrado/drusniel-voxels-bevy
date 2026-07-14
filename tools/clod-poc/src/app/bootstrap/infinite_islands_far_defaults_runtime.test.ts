import { afterEach, describe, expect, it } from "vitest";
import { applyInfiniteIslandsFarDefaults } from "./infinite_islands_far_defaults.js";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalHistory = Object.getOwnPropertyDescriptor(globalThis, "history");

afterEach(() => {
  restoreGlobal("window", originalWindow);
  restoreGlobal("history", originalHistory);
});

describe("infinite-islands far defaults runtime synchronization", () => {
  it("updates the browser URL so later runtime systems observe layout v2", () => {
    let replacedUrl = "";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { href: "http://127.0.0.1:5173/?scene=infinite-islands" } },
    });
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: URL) => {
          replacedUrl = url.toString();
        },
      },
    });

    const params = new URLSearchParams("scene=infinite-islands");
    expect(applyInfiniteIslandsFarDefaults(params)).toBe(true);
    expect(params.get("farSummaryLayout")).toBe("2");
    expect(params.get("farClipmap")).toBe("1");
    expect(params.get("farClipmapMode")).toBe("replace");
    expect(replacedUrl).toContain("farSummaryLayout=2");
  });
});

function restoreGlobal(name: "window" | "history", descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as Record<string, unknown>)[name];
  }
}
