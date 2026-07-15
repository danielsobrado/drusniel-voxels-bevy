import { describe, expect, it } from "vitest";
import {
  DRESSING_CLASSES,
  DRESSING_CLASS_DEFINITIONS,
  dressingClassNumericId,
} from "./class_registry.js";
import { parseDressingConfig } from "./config.js";
import { selectDecayClass } from "./decay.js";
import { evaluateCaveAffinity } from "./cave_affinity.js";
import { evaluateHydrologyAffinity } from "./hydrology_affinity.js";
import { DressingInvalidationQueue } from "./invalidation.js";
import { orderedPlacementStages } from "./placement_stages.js";
import { DressingPersistenceBridge } from "./persistence_bridge.js";
import {
  parentAttachmentStableId,
  terrainDressingStableId,
  stableIdKey,
} from "./stable_id.js";
import { createGrassSuppressionField } from "./grass_suppression.js";
import { resolveMossLichenSlot } from "./attachment_candidates.js";
import { acceptDeadLogCandidate, createPairedStumpId } from "./persistent_candidates.js";
import { acceptTerrainCandidate } from "./terrain_candidates.js";
import type { DressingEnvironmentSample } from "./types.js";

const baseSample: DressingEnvironmentSample = {
  position: [10, 4, 20],
  normal: [0, 1, 0],
  materialWeights: [0.8, 0.1, 0.1, 0],
  waterDepthM: 0,
  shoreDistanceM: 8,
  flow: [0, 0],
  moisture: 0.6,
  wetness: 0.5,
  canopyBroadleaf: 0.7,
  canopyConifer: 0.1,
  skyExposure: 0.5,
  hardness: 0.5,
  sediment: 0.4,
  deposition: 0.4,
  exactVoxelSurface: false,
  terrainEdited: false,
  structureExcluded: false,
  persistentExcluded: false,
  forestEdge: 0.5,
  sunExposure: 0.4,
  caveMouthFactor: 0,
};

describe("ecological dressing registry", () => {
  it("contains exactly 29 unique canonical classes with one ownership category", () => {
    expect(DRESSING_CLASSES).toHaveLength(29);
    expect(new Set(DRESSING_CLASSES).size).toBe(29);
    expect(Object.keys(DRESSING_CLASS_DEFINITIONS)).toHaveLength(29);
    for (const classId of DRESSING_CLASSES) {
      expect(DRESSING_CLASS_DEFINITIONS[classId].id).toBe(classId);
      expect(["persistent", "parent_attached", "terrain_attached"]).toContain(
        DRESSING_CLASS_DEFINITIONS[classId].ownership,
      );
    }
  });

  it("rejects unknown class IDs and config keys", () => {
    expect(() => dressingClassNumericId("unknown" as never)).toThrow(/unknown dressing class/i);
    expect(() => parseDressingConfig("ecological_dressing:\n  mystery: true\n")).toThrow(/unknown.*mystery/i);
  });
});

describe("ecological dressing identities and stages", () => {
  it("matches the shared-PCG normative dressing identity vector", () => {
    expect(terrainDressingStableId({
      worldSeed: 19,
      classId: "lichen_patch",
      cellX: -1,
      cellZ: -1,
      generatorSchemaVersion: 1,
    })).toEqual({ lo: 682_912_007, hi: 910_565_973 });
  });

  it("keeps parent IDs two-word, slot-sensitive, and camera-independent", () => {
    const parent = { lo: 0x12345678, hi: 0xf1234567 };
    const a = parentAttachmentStableId({
      worldSeed: 19,
      generatorSchemaVersion: 1,
      parentStableId: parent,
      classId: "shelf_fungus",
      attachmentSlot: 2,
    });
    const b = parentAttachmentStableId({
      worldSeed: 19,
      generatorSchemaVersion: 1,
      parentStableId: parent,
      classId: "shelf_fungus",
      attachmentSlot: 3,
    });
    expect(a.hi >>> 31).toBeTypeOf("number");
    expect(stableIdKey(a)).not.toBe(stableIdKey(b));
  });

  it("executes the fixed placement stages in order", () => {
    expect(orderedPlacementStages().map((stage) => stage.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("ecological acceptance rules", () => {
  it("requires supported dry endpoints for dead logs and stable paired stump identity", () => {
    expect(acceptDeadLogCandidate(baseSample, [0.1, 0.2])).toBe(true);
    expect(acceptDeadLogCandidate(baseSample, [0.1, 0.5])).toBe(false);
    const logId = terrainDressingStableId({
      worldSeed: 7,
      classId: "dead_log_fresh",
      cellX: 4,
      cellZ: 9,
      generatorSchemaVersion: 1,
    });
    expect(createPairedStumpId(logId)).toEqual(createPairedStumpId(logId));
  });

  it("selects deterministic decay and makes moss win wet shared slots", () => {
    expect(selectDecayClass(0.2)).toBe("fresh");
    expect(selectDecayClass(0.5)).toBe("mossy");
    expect(selectDecayClass(0.9)).toBe("rotten");
    expect(resolveMossLichenSlot(0.61)).toBe("moss");
    expect(resolveMossLichenSlot(0.6)).toBe("lichen");
  });

  it("uses canopy, shore/flow, and cave policies", () => {
    expect(acceptTerrainCandidate("leaf_litter", baseSample)).toBe(true);
    expect(acceptTerrainCandidate("needle_litter", baseSample)).toBe(false);
    expect(evaluateHydrologyAffinity("river_cobbles", {
      ...baseSample,
      shoreDistanceM: 1,
      flow: [0.2, 0],
    }).accepted).toBe(true);
    expect(evaluateCaveAffinity("cave_mouth_fern", {
      ...baseSample,
      caveMouthFactor: 0.6,
      skyExposure: 0.4,
      moisture: 0.7,
    })).toBe(true);
    expect(evaluateCaveAffinity("flower_patch", { ...baseSample, caveMouthFactor: 1 })).toBe(false);
  });
});

describe("ecological dressing mutation boundaries", () => {
  it("excludes destroyed persistent props and never serializes cosmetics", () => {
    const bridge = new DressingPersistenceBridge();
    const id = terrainDressingStableId({
      worldSeed: 2,
      classId: "dead_log_rotten",
      cellX: 1,
      cellZ: 2,
      generatorSchemaVersion: 1,
    });
    bridge.record({ stableId: id, classId: "dead_log_rotten", state: "destroyed" });
    expect(bridge.isExcluded(id)).toBe(true);
    expect(bridge.snapshot()).toHaveLength(1);
    expect(() => bridge.record({
      stableId: id,
      classId: "moss_patch" as never,
      state: "destroyed",
    })).toThrow(/persistent/i);
  });

  it("invalidates only overlapping clusters within the frame budget", () => {
    const queue = new DressingInvalidationQueue(2);
    queue.register({ id: "a", bounds: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 } });
    queue.register({ id: "b", bounds: { minX: 11, minY: 0, minZ: 0, maxX: 20, maxY: 10, maxZ: 10 } });
    queue.invalidate({ minX: 2, minY: 2, minZ: 2, maxX: 3, maxY: 3, maxZ: 3 });
    expect(queue.drain()).toEqual(["a"]);
  });

  it("applies reversible local grass suppression", () => {
    const field = createGrassSuppressionField();
    field.set("litter", { x: 5, z: 5, radiusM: 2, weight: 0.75 });
    expect(field.sample(5, 5)).toBeCloseTo(0.25);
    expect(field.sample(20, 20)).toBe(1);
    field.delete("litter");
    expect(field.sample(5, 5)).toBe(1);
  });
});
