import { describe, expect, it } from "vitest";
import {
  loadBenchmarkContentProfiles,
  parseBenchmarkContentProfiles,
} from "./benchmark_content_profiles.js";
import { WORKLOAD_DESCRIPTOR_KEYS } from "../diagnostics/workload_descriptors.js";

function validProfileYaml(overrides: { id?: string; extraDescriptorLine?: string; dropKey?: string } = {}): string {
  const descriptors = WORKLOAD_DESCRIPTOR_KEYS
    .filter((key) => key !== overrides.dropKey)
    .map((key) => `      ${key}: 1`)
    .join("\n");
  return [
    "profiles:",
    `  - id: ${overrides.id ?? "test-profile"}`,
    "    scene: rpg-village",
    "    description: test",
    "    composition:",
    "      buildings: 1",
    "    descriptors:",
    descriptors,
    ...(overrides.extraDescriptorLine ? [`      ${overrides.extraDescriptorLine}`] : []),
  ].join("\n");
}

describe("benchmark content profiles", () => {
  it("loads the bundled config with rpg-village, rpg-player-base, and the forest ring", () => {
    const profiles = loadBenchmarkContentProfiles();
    expect(profiles.has("rpg-village")).toBe(true);
    expect(profiles.has("rpg-player-base")).toBe(true);
    expect(profiles.has("wilderness-forest-ring")).toBe(true);
    const village = profiles.get("rpg-village")!;
    expect(village.scene).toBe("rpg-village");
    for (const key of WORKLOAD_DESCRIPTOR_KEYS) {
      expect(village.descriptors[key]).toBeTypeOf("number");
    }
  });

  it("accepts a complete profile", () => {
    const { profiles, issues } = parseBenchmarkContentProfiles(validProfileYaml());
    expect(issues).toEqual([]);
    expect(profiles.get("test-profile")?.descriptors.visible_instances).toBe(1);
  });

  it("rejects a profile missing a canonical descriptor", () => {
    const { profiles, issues } = parseBenchmarkContentProfiles(validProfileYaml({ dropKey: "colliders" }));
    expect(issues.some((issue) => issue.path.endsWith("descriptors.colliders"))).toBe(true);
    expect(profiles.size).toBe(0);
  });

  it("rejects unknown descriptor keys (drift protection)", () => {
    const { profiles, issues } = parseBenchmarkContentProfiles(
      validProfileYaml({ extraDescriptorLine: "made_up_metric: 5" }),
    );
    expect(issues.some((issue) => issue.message === "unknown descriptor key")).toBe(true);
    expect(profiles.size).toBe(0);
  });

  it("rejects duplicate profile ids", () => {
    const yaml = `${validProfileYaml()}\n${validProfileYaml().replace("profiles:\n", "")}`;
    const { issues } = parseBenchmarkContentProfiles(yaml);
    expect(issues.some((issue) => issue.message.includes("duplicate profile id"))).toBe(true);
  });

  it("rejects negative or non-numeric descriptors", () => {
    const yaml = validProfileYaml().replace("      visible_instances: 1", "      visible_instances: -3");
    const { profiles, issues } = parseBenchmarkContentProfiles(yaml);
    expect(issues.some((issue) => issue.path.endsWith("visible_instances"))).toBe(true);
    expect(profiles.size).toBe(0);
  });

  it("rejects a missing profiles list", () => {
    const { issues } = parseBenchmarkContentProfiles("not_profiles: []");
    expect(issues[0]?.message).toContain("profiles");
  });
});
