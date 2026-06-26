import { describe, expect, it } from "vitest";
import { compressPayload, decompressPayload } from "../compression.js";

describe("compression", () => {
  it("none mode round-trips", async () => {
    const input = new TextEncoder().encode("plain payload").buffer;
    const compressed = await compressPayload(input, "none");
    expect(compressed.mode).toBe("none");
    const out = await decompressPayload(compressed.bytes, "none");
    expect(new TextDecoder().decode(out)).toBe("plain payload");
  });

  it("gzip round-trips when available", async () => {
    if (typeof CompressionStream === "undefined") return;
    const input = new TextEncoder().encode("gzip me " + "x".repeat(200)).buffer;
    const compressed = await compressPayload(input, "gzip");
    const out = await decompressPayload(compressed.bytes, compressed.mode);
    expect(new TextDecoder().decode(out)).toBe("gzip me " + "x".repeat(200));
  });
});
