import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropValidationIssue, PropValidationReport } from "./prop_types.js";

function issue(severity: "error" | "warning", code: string, message: string): PropValidationIssue {
  return { severity, code, message };
}

export function validatePropAssetDef(def: PropAssetDef): PropValidationIssue[] {
  const issues: PropValidationIssue[] = [];
  if (!def.id.trim()) issues.push(issue("error", "MISSING_ID", "Prop asset id is required."));
  if (!def.source.trim()) issues.push(issue("error", "MISSING_SOURCE", `Prop "${def.id}" is missing source path.`));
  if (def.lod.distances.length === 0) {
    issues.push(issue("error", "LOD_DISTANCES_EMPTY", `Prop "${def.id}" must declare at least one LOD distance.`));
  }
  if (def.lod.triangleRatios.length === 0) {
    issues.push(issue("error", "LOD_RATIOS_EMPTY", `Prop "${def.id}" must declare triangle_ratios.`));
  }
  for (let i = 1; i < def.lod.distances.length; i++) {
    if (def.lod.distances[i]! < def.lod.distances[i - 1]!) {
      issues.push(
        issue("error", "LOD_DISTANCES_NON_MONOTONIC", `Prop "${def.id}" LOD distances must be non-decreasing.`),
      );
      break;
    }
  }
  for (const ratio of def.lod.triangleRatios) {
    if (ratio <= 0 || ratio > 1) {
      issues.push(issue("error", "LOD_RATIO_OUT_OF_RANGE", `Prop "${def.id}" triangle_ratios must stay in (0, 1].`));
      break;
    }
  }
  if (def.culling.maxDistance <= 0) {
    issues.push(issue("error", "CULL_DISTANCE_INVALID", `Prop "${def.id}" max_distance must be positive.`));
  }
  return issues;
}

export function validatePropAssetMetadata(
  def: PropAssetDef,
  metadata: PropAssetMetadata,
  settings: CustomPropsSettings,
): PropValidationReport {
  const errors: PropValidationIssue[] = [];
  const warnings: PropValidationIssue[] = [];
  const push = (severity: "error" | "warning", code: string, message: string) => {
    (severity === "error" ? errors : warnings).push(issue(severity, code, message));
  };

  errors.push(...validatePropAssetDef(def));

  if (metadata.meshCount === 0) push("error", "NO_MESHES", `Prop "${def.id}" contains no mesh geometry.`);
  if (metadata.triangleCount === 0) push("error", "NO_TRIANGLES", `Prop "${def.id}" contains no triangles.`);
  if (!metadata.hasNormals) push("error", "MISSING_NORMALS", `Prop "${def.id}" is missing vertex normals.`);
  if (metadata.localBounds.radius <= 0) {
    push("error", "NO_BOUNDS", `Prop "${def.id}" has empty or zero bounds.`);
  }
  if (!metadata.scaleUniform) {
    push("warning", "NON_UNIFORM_SCALE", `Prop "${def.id}" has non-uniform mesh scale baked into geometry nodes.`);
  }

  const budget = settings.categoryBudgets[def.category];
  if (metadata.triangleCount > budget.maxTriangles) {
    push(
      "error",
      "TRIANGLE_BUDGET_EXCEEDED",
      `Prop "${def.id}" has ${metadata.triangleCount} triangles; ${def.category} budget is ${budget.maxTriangles}.`,
    );
  }
  if (metadata.materialCount > budget.maxMaterials) {
    push(
      "error",
      "MATERIAL_BUDGET_EXCEEDED",
      `Prop "${def.id}" has ${metadata.materialCount} materials; ${def.category} budget is ${budget.maxMaterials}.`,
    );
  }
  if (metadata.drawCallParts > budget.maxDrawParts) {
    push(
      "warning",
      "DRAW_PART_BUDGET_EXCEEDED",
      `Prop "${def.id}" has ${metadata.drawCallParts} draw parts; ${def.category} budget is ${budget.maxDrawParts}.`,
    );
  }
  if (metadata.maxTextureSize > budget.maxTexturePx) {
    push(
      "warning",
      "TEXTURE_SIZE_EXCEEDED",
      `Prop "${def.id}" uses ${metadata.maxTextureSize}px textures; ${def.category} budget is ${budget.maxTexturePx}px.`,
    );
  }
  if (metadata.hasAlphaMaterial && def.category !== "vegetation" && def.category !== "small_decor") {
    push(
      "warning",
      "ALPHA_WITHOUT_POLICY",
      `Prop "${def.id}" has alpha materials but category "${def.category}" has no alpha-cutout render policy yet.`,
    );
  }
  if (metadata.hasAnimation) {
    push("warning", "HAS_ANIMATION", `Prop "${def.id}" contains skeletal animation; runtime animation is not wired yet.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateCustomPropsManifest(settings: CustomPropsSettings): PropValidationReport {
  const errors: PropValidationIssue[] = [];
  const warnings: PropValidationIssue[] = [];
  const seen = new Set<string>();
  for (const def of settings.props) {
    for (const issue of validatePropAssetDef(def)) {
      (issue.severity === "error" ? errors : warnings).push(issue);
    }
    if (seen.has(def.id)) {
      errors.push({ severity: "error", code: "DUPLICATE_ID", message: `Duplicate prop id "${def.id}".` });
    }
    seen.add(def.id);
  }
  if (settings.spatial.cellSizeM <= 0) {
    errors.push({ severity: "error", code: "CELL_SIZE_INVALID", message: "prop_spatial.cell_size_m must be positive." });
  }
  return { ok: errors.length === 0, errors, warnings };
}
