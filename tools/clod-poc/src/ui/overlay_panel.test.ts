import { describe, expect, it } from "vitest";
import { formatOverlayAverageFps, formatOverlayPosition } from "./overlay_panel.js";

describe("CLOD overlay primary stats", () => {
  it("formats logical world coordinates clearly", () => {
    expect(formatOverlayPosition({ x: 1000, y: 96.25, z: 5168 })).toBe(
      "X 1,000.0   Z 5,168.0   H 96.3",
    );
  });

  it("labels the rolling average FPS", () => {
    expect(formatOverlayAverageFps(33.6)).toBe("AVG FPS 34");
    expect(formatOverlayAverageFps(0)).toBe("AVG FPS --");
  });
});
