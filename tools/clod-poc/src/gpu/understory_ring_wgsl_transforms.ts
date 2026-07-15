const BASE_HEIGHT_SAMPLE = "  let base_height = placement_base_ground_height(wpos.x, wpos.y);\n";
const EXCLUSION_GUARD = `${BASE_HEIGHT_SAMPLE}  if (placement_ground_height_is_excluded(base_height)) { return; }\n`;

export function withUnderstoryAuthorityExclusion(source: string): string {
  if (!source.includes(BASE_HEIGHT_SAMPLE)) {
    throw new Error("understory shader is missing the canonical base-height sample");
  }
  return source.replace(BASE_HEIGHT_SAMPLE, EXCLUSION_GUARD);
}
