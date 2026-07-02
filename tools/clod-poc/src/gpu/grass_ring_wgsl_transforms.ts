export function withConservativeGrassFrustum(source: string): string {
  return source.replace(
    "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), 2.5)) { return; }",
    "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), max(6.0, cell_size * 0.75))) { return; }",
  );
}
