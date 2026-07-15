import { describe, expect, it } from "vitest";
import { isErosionAbort, throwErosionAbort } from "./abort.js";

describe("erosion cancellation", () => {
  it("recognizes AbortError without treating it as GPU failure", () => {
    const error = new DOMException("cancelled", "AbortError");
    expect(isErosionAbort(error)).toBe(true);
    expect(() => throwErosionAbort(error)).toThrow(error);
  });

  it("prefers the AbortSignal reason", () => {
    const controller = new AbortController();
    const reason = new Error("user cancelled world generation");
    reason.name = "AbortError";
    controller.abort(reason);
    expect(isErosionAbort(new Error("GPU failure"), controller.signal)).toBe(true);
    expect(() => throwErosionAbort(new Error("GPU failure"), controller.signal)).toThrow(reason);
  });

  it("does not classify normal GPU failures as cancellation", () => {
    expect(isErosionAbort(new Error("device lost"))).toBe(false);
  });
});
