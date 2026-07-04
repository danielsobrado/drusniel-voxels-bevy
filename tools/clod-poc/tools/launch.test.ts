import { describe, expect, it } from "vitest";
import { clodUrl } from "./launch.js";

describe("clodUrl", () => {
  it("infers an outside camera for infinite-islands spawn URLs", () => {
    const url = new URL(clodUrl({
      scene: "infinite-islands",
      seed: 1,
      hud: true,
      extra: { x: "2048", z: "2048", yaw: "2.65" },
    }, "http://127.0.0.1:5173/"));

    expect(url.searchParams.get("cam")).toBe("2048,96,2048,2.6500,-0.4300,55");
    expect(url.searchParams.get("x")).toBe("2048");
    expect(url.searchParams.get("z")).toBe("2048");
  });

  it("does not infer cameras for normal scenes", () => {
    const url = new URL(clodUrl({
      scene: "sanity",
      extra: { x: "2048", z: "2048", yaw: "2.65" },
    }, "http://127.0.0.1:5173/"));

    expect(url.searchParams.get("cam")).toBeNull();
  });
});
