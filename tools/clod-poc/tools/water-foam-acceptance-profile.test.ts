import { describe, expect, it } from "vitest";
import {
  buildWaterFoamAcceptanceUrl,
  getWaterFoamAcceptanceProfile,
  parseWaterFoamAcceptanceQuality,
} from "./water-foam-acceptance-profile.js";

describe("water foam acceptance profiles", () => {
  it("normalizes supported quality aliases", () => {
    expect(parseWaterFoamAcceptanceQuality("high")).toBe("high");
    expect(parseWaterFoamAcceptanceQuality("hq")).toBe("high");
    expect(parseWaterFoamAcceptanceQuality("low")).toBe("low");
    expect(parseWaterFoamAcceptanceQuality("performance")).toBe("low");
  });

  it("rejects unknown qualities", () => {
    expect(() => parseWaterFoamAcceptanceQuality("balanced")).toThrow(/expected high or low/);
  });

  it("forces explicit quality-tier query state", () => {
    const high = new URL(buildWaterFoamAcceptanceUrl("http://127.0.0.1:5180/", "7", 16, "high"));
    const low = new URL(buildWaterFoamAcceptanceUrl("http://127.0.0.1:5180/", "7", 16, "low"));

    expect(high.searchParams.get("waterQuality")).toBe("high");
    expect(high.searchParams.get("waterPerf")).toBe("0");
    expect(low.searchParams.get("waterQuality")).toBe("low");
    expect(low.searchParams.get("waterPerf")).toBe("1");
    expect(high.searchParams.get("scene")).toBe("infinite-islands");
    expect(low.searchParams.get("seed")).toBe("7");
  });

  it("uses stable output folders for the matrix", () => {
    expect(getWaterFoamAcceptanceProfile("high").outputFolder).toBe("high");
    expect(getWaterFoamAcceptanceProfile("low").outputFolder).toBe("low");
  });
});
