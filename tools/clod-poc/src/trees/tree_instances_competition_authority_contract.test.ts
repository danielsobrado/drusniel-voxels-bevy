import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./tree_instances.ts", import.meta.url), "utf8");

describe("CPU tree competition authority", () => {
  it("derives morphology only after final spacing acceptance", () => {
    const acceptance = source.indexOf("accepted.push(candidate.instance)");
    const competition = source.indexOf("createAcceptedTreeCompetitionSampler(");
    const derivation = source.indexOf("morphology: deriveTreeInstanceMorphology(");

    expect(acceptance).toBeGreaterThan(0);
    expect(competition).toBeGreaterThan(acceptance);
    expect(derivation).toBeGreaterThan(competition);
    expect(source).not.toContain("sampleTreeCompetition({");
  });

  it("uses retained crown dimensions and stable identities", () => {
    expect(source).toContain("crownRadiusM: settings.species[instance.species].crownRadiusM * instance.scale");
    expect(source).toContain("competition.sample(instance.identity)");
    expect(source).toContain("morphologyTerrain");
    expect(source).toContain("morphologyEcology");
  });
});
