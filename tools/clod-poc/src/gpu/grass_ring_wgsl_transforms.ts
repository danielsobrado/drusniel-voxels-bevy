export function withConservativeGrassFrustum(source: string): string {
  return source.replace(
    "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), 2.5)) { return; }",
    "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), max(6.0, cell_size * 0.75))) { return; }",
  );
}

export function withGrassActiveSlotList(source: string): string {
  let next = source.replace(/\r\n/g, "\n");
  if (!next.includes("var<storage, read> grass_active_slot_indices: array<u32>;")) {
    next = next.replace(
      "@group(0) @binding(10) var hydro_sampler: sampler;",
      "@group(0) @binding(10) var hydro_sampler: sampler;\n@group(0) @binding(11) var<storage, read> grass_active_slot_indices: array<u32>;",
    );
  }

  next = next.replace(
    /fn grass_cull\(@builtin\(global_invocation_id\) id: vec3<u32>\) \{ process_slot\(id\.x\); \}/,
    `fn grass_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = grass_active_slot_indices[id.x];
  if (slot == 0xffffffffu) { return; }
  process_slot(slot);
}`,
  );

  if (!next.includes("grass_active_slot_indices[id.x]") || next.includes("process_slot(id.x);")) {
    throw new Error("grass ring WGSL active-slot transform failed");
  }
  return next;
}
