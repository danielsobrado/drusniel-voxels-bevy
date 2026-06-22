import { describe, expect, it } from "vitest";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { parsePhase1Config } from "./phase1_config.js";

describe("parsePhase1Config", () => {
  it("parses the bundled config", () => {
    const config = parsePhase1Config(phase1ConfigText);
    expect(config.world.sizeM).toBe(4096);
    expect(config.world.baseGrid).toBe(1024);
    expect(config.debug.modes).toContain("height");
  });

  it("rejects invalid numeric ranges", () => {
    const invalid = phase1ConfigText.replace("size_m: 4096", "size_m: -1");
    expect(() => parsePhase1Config(invalid)).toThrow(/size_m/);
  });
});
