import { describe, expect, it } from "vitest";
import {
  EditedWaterAuthoritySource,
  createCanonicalWaterAuthority,
  type WaterAuthoritySource,
  type WaterSample,
} from "./water_authority.js";

function source(id: string, sample: WaterSample | null, revision = 0): WaterAuthoritySource {
  return { id, revision: () => revision, sample: () => sample };
}

const generatedLake: WaterSample = {
  state: "water",
  surfaceY: 12,
  bottomY: 5,
  bodyId: "hydrology:42",
  bodyKind: "lake",
  flow: [0, 0],
  sourceRevision: 3,
};

describe("canonical water authority", () => {
  it("uses edited water before generated hydrology", () => {
    const edited = new EditedWaterAuthoritySource();
    edited.upsert({
      id: "raised-reservoir",
      kind: "flood",
      minX: 0,
      maxX: 10,
      minZ: 0,
      maxZ: 10,
      surfaceY: 18,
      bottomY: 4,
      flow: [0.5, 0],
    });
    const authority = createCanonicalWaterAuthority([edited, source("generated", generatedLake, 3)]);

    expect(authority.sample(5, 5)).toEqual({
      state: "water",
      surfaceY: 18,
      bottomY: 4,
      bodyId: "edited:raised-reservoir",
      bodyKind: "flood",
      flow: [0.5, 0],
      sourceRevision: 1,
    });
  });

  it("lets an edited dry overlay dam or remove generated water", () => {
    const edited = new EditedWaterAuthoritySource();
    edited.upsert({
      id: "dammed-cell",
      kind: "river",
      minX: 0,
      maxX: 10,
      minZ: 0,
      maxZ: 10,
      surfaceY: 12,
      state: "dry",
    });
    const authority = createCanonicalWaterAuthority([edited, source("generated", generatedLake)]);

    expect(authority.sample(5, 5).state).toBe("dry");
    expect(authority.sample(12, 5)).toEqual(generatedLake);
  });

  it("supports a cave pond independent of generated surface water", () => {
    const edited = new EditedWaterAuthoritySource();
    edited.upsert({
      id: "cave-pond-a",
      kind: "pond",
      minX: 100,
      maxX: 112,
      minZ: 40,
      maxZ: 54,
      surfaceY: -18,
      bottomY: -24,
    });
    const authority = createCanonicalWaterAuthority([edited, source("generated", null)]);

    const sample = authority.sample(105, 45);
    expect(sample.state).toBe("water");
    expect(sample.bodyId).toBe("edited:cave-pond-a");
    expect(sample.surfaceY).toBe(-18);
    expect(sample.bottomY).toBe(-24);
  });

  it("keeps unknown distinct from dry and fails readiness closed", () => {
    const unknown: WaterSample = {
      state: "unknown",
      surfaceY: Number.NaN,
      bodyId: "",
      bodyKind: "pond",
      flow: [0, 0],
      sourceRevision: 9,
    };
    const authority = createCanonicalWaterAuthority([source("streaming", unknown, 9)]);

    expect(authority.sample(5, 5).state).toBe("unknown");
    expect(authority.readyAt(5, 5)).toBe(false);
    expect(authority.revision()).toBe(9);
  });

  it("invalidates the composed revision when either source changes", () => {
    let generatedRevision = 100;
    const edited = new EditedWaterAuthoritySource();
    const generated: WaterAuthoritySource = {
      id: "generated",
      revision: () => generatedRevision,
      sample: () => generatedLake,
    };
    const authority = createCanonicalWaterAuthority([edited, generated]);
    const initial = authority.revision();

    edited.upsert({ id: "pond", kind: "pond", minX: 0, maxX: 1, minZ: 0, maxZ: 1, surfaceY: 2 });
    const afterEdit = authority.revision();
    generatedRevision += 1;
    const afterGenerated = authority.revision();

    expect(afterEdit).not.toBe(initial);
    expect(afterGenerated).not.toBe(afterEdit);
  });

  it("resolves overlapping edits by priority then stable id", () => {
    const edited = new EditedWaterAuthoritySource();
    edited.upsert({ id: "z", kind: "pond", minX: 0, maxX: 10, minZ: 0, maxZ: 10, surfaceY: 4, priority: 1 });
    edited.upsert({ id: "a", kind: "flood", minX: 0, maxX: 10, minZ: 0, maxZ: 10, surfaceY: 5, priority: 1 });
    edited.upsert({ id: "high", kind: "lake", minX: 0, maxX: 10, minZ: 0, maxZ: 10, surfaceY: 6, priority: 2 });

    expect(edited.sample(5, 5)?.bodyId).toBe("edited:high");
    expect(edited.remove("high")).toBe(true);
    expect(edited.sample(5, 5)?.bodyId).toBe("edited:a");
    expect(edited.revision()).toBe(4);
  });
});
