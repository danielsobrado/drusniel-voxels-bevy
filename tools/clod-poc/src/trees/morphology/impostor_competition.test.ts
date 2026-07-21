import { describe, expect, it } from "vitest";
import {
  resolveTreeMorphologyEvidenceMode,
  TREE_IMPOSTOR_USES_RECORD_MORPHOLOGY,
  treeMorphologyEvidenceColor,
} from "./impostor_competition.js";

describe("tree impostor morphology authority", () => {
  it("keeps the accepted instance record as the production morphology authority", () => {
    expect(TREE_IMPOSTOR_USES_RECORD_MORPHOLOGY).toBe(true);
  });

  it("provides explicit age and competition evidence modes", () => {
    expect(resolveTreeMorphologyEvidenceMode(new URLSearchParams("treeMorphologyEvidence=age"))).toBe("age");
    expect(resolveTreeMorphologyEvidenceMode(new URLSearchParams("treeMorphologyEvidence=competition"))).toBe("competition");
    expect(resolveTreeMorphologyEvidenceMode(new URLSearchParams("treeMorphologyEvidence=unknown"))).toBe("off");
    expect(treeMorphologyEvidenceColor("competition", 0.5, 1)[0])
      .toBeGreaterThan(treeMorphologyEvidenceColor("competition", 0.5, 0)[0]);
    expect(treeMorphologyEvidenceColor("age", 1, 0)[1])
      .toBeLessThan(treeMorphologyEvidenceColor("age", 0, 0)[1]);
  });
});
