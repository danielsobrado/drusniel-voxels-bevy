import { describe, expect, it } from "vitest";
import config from "../vite.config.js";

describe("vite dev-server watch config", () => {
  it("does not reload perf harness pages when run artifacts are written", async () => {
    const resolved = typeof config === "function"
      ? await config({ command: "serve", mode: "development" })
      : config;

    expect(resolved.server?.watch?.ignored).toContain("**/perf-runs/**");
  });
});
