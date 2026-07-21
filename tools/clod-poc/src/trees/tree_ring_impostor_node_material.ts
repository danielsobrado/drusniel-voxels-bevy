import * as THREE from "three";
import {
  clamp,
  float,
  max,
  mix,
  texture,
  uniform,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeHydrologyWater, TreeRingInstanceBuffers } from "./tree_node_material.js";
import { treeMorphologyRecordNodes } from "./morphology/node_deformation.js";
import {
  resolveTreeMorphologyEvidenceMode,
  type TreeMorphologyEvidenceMode,
} from "./morphology/impostor_competition.js";
import {
  createTreeRingImpostorNodeMaterialHandle as createBaseHandle,
} from "./tree_ring_impostor_node_material_base.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;
type NodeMaterialShape = THREE.Material & {
  colorNode?: TslNode;
  needsUpdate: boolean;
};

export function createTreeRingImpostorNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  atlas: TreeImpostorAtlas,
  lighting?: EnvironmentLighting,
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const base = createBaseHandle(settings, buffers, atlas, lighting, hydrology);
  const evidenceMode = resolveEvidenceMode();
  const neutralDetail = createNeutralDetailTexture();
  const uForestWorldSize = uniform(1) as TslNode;
  const uCompetitionEnabled = uniform(0) as TslNode;
  const record = treeMorphologyRecordNodes(buffers);
  const competitionUv: TslNode = clamp(
    record.positionScale.xz.div(max(uForestWorldSize, float(1))),
    0,
    1,
  );
  const detailNode: TslNode = texture(neutralDetail, competitionUv);
  const competition: TslNode = clamp(detailNode.w.mul(uCompetitionEnabled), 0, 1);
  const age: TslNode = clamp(record.morphology0.x, 0, 1);

  const decorate = (materialValue: THREE.Material): void => {
    const material = materialValue as NodeMaterialShape;
    if (!material.colorNode) return;
    const originalColor: TslNode = material.colorNode;
    material.colorNode = evidenceMode === "age"
      ? ageEvidence(age)
      : evidenceMode === "competition"
        ? competitionEvidence(competition)
        : originalColor;
    material.needsUpdate = true;
  };

  decorate(base.regularMaterial);
  for (const material of Object.values(base.debugMaterials) as THREE.Material[]) decorate(material);

  const originalUpdateForestLighting = base.updateForestLighting?.bind(base);
  const originalDispose = base.dispose.bind(base);
  publishEvidenceCounters(evidenceMode, false);

  return {
    ...base,
    updateForestLighting(state: ForestLightingMaterialState | null) {
      originalUpdateForestLighting?.(state);
      const enabled = state?.settings.enabled === true
        && state.settings.materialIntegration.treeEnabled;
      uCompetitionEnabled.value = enabled ? 1 : 0;
      uForestWorldSize.value = state?.worldCells ?? 1;
      detailNode.value = state?.textureHandle.detailTexture ?? neutralDetail;
      publishEvidenceCounters(evidenceMode, enabled);
    },
    dispose() {
      neutralDetail.dispose();
      originalDispose();
    },
  };
}

function ageEvidence(age: TslNode): TslNode {
  const young: TslNode = vec3(0.12, 0.78, 0.18);
  const mature: TslNode = vec3(0.88, 0.68, 0.10);
  const old: TslNode = vec3(0.95, 0.18, 0.08);
  return age.lessThan(0.5).select(
    mix(young, mature, age.mul(2)),
    mix(mature, old, age.sub(0.5).mul(2)),
  );
}

function competitionEvidence(competition: TslNode): TslNode {
  return mix(vec3(0.10, 0.72, 0.36), vec3(0.96, 0.12, 0.05), competition);
}

function resolveEvidenceMode(): TreeMorphologyEvidenceMode {
  if (typeof window === "undefined") return "off";
  return resolveTreeMorphologyEvidenceMode(new URLSearchParams(window.location.search));
}

function createNeutralDetailTexture(): THREE.DataTexture {
  const textureValue = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  textureValue.name = "tree-impostor-competition-neutral";
  textureValue.needsUpdate = true;
  return textureValue;
}

function publishEvidenceCounters(mode: TreeMorphologyEvidenceMode, authorityActive: boolean): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["tree_impostor_age_layers_active"] = 1;
  counters["tree_impostor_competition_authority"] = authorityActive ? 1 : 0;
  counters["tree_impostor_secondary_competition_response"] = 0;
  counters["tree_morphology_record_authority"] = 1;
  counters["tree_impostor_evidence_mode"] = mode === "age" ? 1 : mode === "competition" ? 2 : 0;
}
