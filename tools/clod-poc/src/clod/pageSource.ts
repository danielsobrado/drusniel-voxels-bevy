import type { PageMesh } from "../types.js";
import { assertMaterialWeights } from "../material/material_weights.js";
import {
  pageSourceSectionDecision,
  type PageSourceSection,
  type PageSourceSectionDecision,
} from "./pageSourceSections.js";

export interface FilteredPageSource {
  mesh: PageMesh;
  includedSections: PageSourceSection[];
  excludedSections: PageSourceSection[];
  decisions: PageSourceSectionDecision[];
  includedTriangles: number;
  excludedTriangles: number;
}

/** Concatenate filtered page-source meshes without changing source attributes. */
export function concatPageSourceMeshes(meshes: readonly PageMesh[]): PageMesh {
  let vertexCount = 0;
  let indexCount = 0;
  let weightStride = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.positions.length / 3;
    indexCount += mesh.indices.length;
    weightStride = Math.max(weightStride, mesh.materialWeightStride);
  }
  if (weightStride === 0) weightStride = 4;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const paintSlots = new Float32Array(vertexCount);
  const materialWeights = new Float32Array(vertexCount * weightStride);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    assertMaterialWeights(mesh, "page source concat input");
    positions.set(mesh.positions, vertexOffset * 3);
    normals.set(mesh.normals, vertexOffset * 3);
    paintSlots.set(mesh.paintSlots, vertexOffset);
    const meshVertexCount = mesh.positions.length / 3;
    for (let vertex = 0; vertex < meshVertexCount; vertex += 1) {
      for (let slot = 0; slot < weightStride; slot += 1) {
        materialWeights[(vertexOffset + vertex) * weightStride + slot] =
          slot < mesh.materialWeightStride
            ? mesh.materialWeights[vertex * mesh.materialWeightStride + slot]
            : slot === 0 ? 1 : 0;
      }
    }
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = mesh.indices[index] + vertexOffset;
    }
    vertexOffset += meshVertexCount;
    indexOffset += mesh.indices.length;
  }
  return {
    positions,
    normals,
    paintSlots,
    materialWeights,
    materialWeightStride: weightStride,
    indices,
  };
}

export function filterPageSourceSections(
  sections: readonly PageSourceSection[],
): FilteredPageSource {
  if (sections.length === 0) {
    throw new Error("Page source: at least one source section is required");
  }
  const decisions = sections.map(pageSourceSectionDecision);
  const includedSections = decisions
    .filter((decision) => decision.included)
    .map((decision) => decision.section);
  const excludedSections = decisions
    .filter((decision) => !decision.included)
    .map((decision) => decision.section);
  if (includedSections.length === 0) {
    const reasons = decisions.map((decision) => decision.reason).join("; ");
    throw new Error(`Page source: no main terrain sections survived filtering: ${reasons}`);
  }

  return {
    mesh: concatPageSourceMeshes(includedSections.map((section) => section.mesh)),
    includedSections,
    excludedSections,
    decisions,
    includedTriangles: triangleCount(includedSections),
    excludedTriangles: triangleCount(excludedSections),
  };
}

function triangleCount(sections: readonly PageSourceSection[]): number {
  return sections.reduce((count, section) => count + section.mesh.indices.length / 3, 0);
}
