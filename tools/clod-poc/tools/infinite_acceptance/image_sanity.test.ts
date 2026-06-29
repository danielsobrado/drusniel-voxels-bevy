import { describe, expect, it } from "vitest";
import { classifyImagePixels } from "./image_sanity.js";

describe("image sanity classification", () => {
  it("rejects flat black images", () => {
    const result = classifyImagePixels({
      data: new Uint8Array(4 * 4 * 4),
      width: 4,
      height: 4,
      channels: 4,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.includes("almost black"))).toBe(true);
  });

  it("accepts varied opaque RGB content", () => {
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const base = i * 4;
      data[base] = i * 12;
      data[base + 1] = 220 - i * 7;
      data[base + 2] = 40 + i * 5;
      data[base + 3] = 255;
    }
    expect(classifyImagePixels({ data, width: 4, height: 4, channels: 4 }).passed).toBe(true);
  });
});
