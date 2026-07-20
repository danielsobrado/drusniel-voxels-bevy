import { describe, expect, it } from "vitest";
import {
  applyTreeImpostorCompetition,
  resolveTreeMorphologyEvidenceMode,
  treeMorphologyEvidenceColor,
} from "./impostor_competition.js";

describe("tree impostor age and competition", () => {
  it("compresses crowns and reduces retained foliage under accepted-canopy competition", () => {
    const open = applyTreeImpostorCompetition(0.7, 0.9, 0.95, 0);
    const crowded = applyTreeImpostorCompetition(0.7, 0.9, 0.95, 1);
    expect(crowded.effectiveAge).toBeLessThan(open.effectiveAge);
    expect(crowded.crownWidthScale).toBeLessThan(open.crownWidthScale);
    expect(crowded.foliageRetention).toBeLessThan(open.foliageRetention);
    expect(crowded.health).toBeLessThan(open.health);
  });

  it("provides explicit visual evidence modes", () => {
    expect(resolveTreeMorphologyEvidenceMode(new URLSearchParams("treeMorphologyEvidence=age"))).toBe("age");
    expect(resolveTreeMorphologyEvidenceMode(new URLSearchParams("treeMorphologyEvidence=competition"))).toBe("competition");
    expect(treeMorphologyEvidenceColor("competition", 0.5, 1)[0]).toBeGreaterThan(treeMorphologyEvidenceColor("competition", 0.5, 0)[0]);
  });
});
