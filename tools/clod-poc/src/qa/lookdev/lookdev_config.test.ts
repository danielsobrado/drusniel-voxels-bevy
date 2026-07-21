import { describe, expect, it } from "vitest";
import { loadLookdevConfig } from "./lookdev_config.js";

describe("lookdev QA config", () => {
  it("loads fixed smoke and full suites", () => {
    const config = loadLookdevConfig("config/lookdev_qa.yaml");
    expect(config.schemaVersion).toBe(1);
    expect(config.suites.smoke.poses.length).toBeGreaterThan(0);
    expect(config.suites.full.poses).toContain("ownership");
    expect(config.poses.find((pose) => pose.id === "ownership")?.diagnostic).toBe("ownership");
  });
});
