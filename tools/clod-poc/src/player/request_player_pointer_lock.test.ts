import { describe, expect, it, vi } from "vitest";
import { tryRequestPlayerPointerLock } from "./request_player_pointer_lock.js";

describe("player pointer-lock requests", () => {
  it("contains browser rejection so callers never create an unhandled rejection", async () => {
    const requestPointerLock = vi.fn(async () => {
      throw new DOMException("root document is not valid", "WrongDocumentError");
    });

    await expect(tryRequestPlayerPointerLock({ requestPointerLock })).resolves.toBe(false);
    expect(requestPointerLock).toHaveBeenCalledOnce();
  });

  it("reports a granted pointer lock", async () => {
    await expect(tryRequestPlayerPointerLock({
      requestPointerLock: vi.fn(async () => undefined),
    })).resolves.toBe(true);
  });
});
