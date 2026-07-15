import type { DressingClassId } from "./class_registry.js";
import type { DressingAttachmentAnchor } from "./attachment_anchors.js";
import { parentAttachmentStableId } from "./stable_id.js";
import type { DressingEnvironmentSample, DressingStableId, DressingTransform } from "./types.js";

export function resolveMossLichenSlot(moisture01: number): "moss" | "lichen" {
  return moisture01 > 0.6 ? "moss" : "lichen";
}

export interface AttachmentParent {
  readonly stableId: DressingStableId;
  readonly transform: DressingTransform;
  readonly age01: number;
  readonly health01: number;
  readonly decay01: number;
  readonly destroyed: boolean;
}

export function attachmentAllowed(
  classId: DressingClassId,
  parent: AttachmentParent,
  anchor: DressingAttachmentAnchor,
  sample: DressingEnvironmentSample,
): boolean {
  if (parent.destroyed || sample.structureExcluded || sample.persistentExcluded) return false;
  const drySandOrSnow = sample.materialWeights[2] >= 0.65 || sample.materialWeights[3] >= 0.5;
  if (classId === "shelf_fungus") return !drySandOrSnow && parent.decay01 >= 0.33 && sample.moisture >= 0.45;
  if (classId === "cap_fungus") {
    return !drySandOrSnow
      && parent.decay01 > 0.72
      && sample.moisture >= 0.55
      && sample.sunExposure <= 0.55
      && sample.waterDepthM === 0;
  }
  if (classId === "trunk_moss" || classId === "root_moss") return resolveMossLichenSlot(sample.moisture) === "moss";
  if (classId === "trunk_lichen") return resolveMossLichenSlot(sample.moisture) === "lichen";
  if (classId === "hanging_vine") return anchor.exposure01 <= 0.75 && sample.moisture >= 0.4;
  if (classId === "root_fern") return anchor.kind === "root_flare" && sample.moisture >= 0.5;
  return true;
}

export function attachmentId(
  worldSeed: number,
  generatorSchemaVersion: number,
  parent: AttachmentParent,
  classId: DressingClassId,
  anchor: DressingAttachmentAnchor,
): DressingStableId {
  return parentAttachmentStableId({
    worldSeed,
    generatorSchemaVersion,
    parentStableId: parent.stableId,
    classId,
    attachmentSlot: anchor.slot,
  });
}
