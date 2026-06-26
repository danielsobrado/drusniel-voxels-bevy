import { describe, expect, it } from "vitest";
import { sha256Hex } from "../checksum.js";

describe("checksum", () => {
  it("produces stable sha256 hex", async () => {
    const bytes = new TextEncoder().encode("hello").buffer;
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(bytes);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects modified bytes", async () => {
    const bytes = new TextEncoder().encode("hello").buffer;
    const modified = new TextEncoder().encode("hellp").buffer;
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(modified);
    expect(a).not.toBe(b);
  });
});
