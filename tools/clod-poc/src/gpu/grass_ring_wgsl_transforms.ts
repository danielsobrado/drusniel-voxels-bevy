const HYDRO_SAMPLER_BINDING = "@group(0) @binding(10) var hydro_sampler: sampler;";
const ACTIVE_SLOT_BINDING = "@group(0) @binding(11) var<storage, read> active_slots: array<u32>;";
const LEGACY_ACTIVE_SLOT_BINDING = "@group(0) @binding(11) var<storage, read> grass_active_slot_indices: array<u32>;";
const ACTIVE_SLOT_SENTINEL = "4294967295u";

export function withConservativeGrassFrustum(source: string): string {
  return source
    .replace(
      "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), 2.5)) { return; }",
      "if (!in_frustum(vec3<f32>(wpos.x, height + 1.0, wpos.y), max(6.0, cell_size * 0.75))) { return; }",
    )
    .replace(
      "if (!in_frustum(vec3<f32>(wpos.x, height + 0.5, wpos.y), 1.4)) { return; }",
      "if (!in_frustum(vec3<f32>(wpos.x, height + 0.5, wpos.y), max(6.0, params.settings_a.x * 0.75))) { return; }",
    );
}

export function withGrassActiveSlotList(source: string): string {
  let next = source.replace(/\r\n/g, "\n");
  next = next.replaceAll("grass_active_slot_indices", "active_slots");

  if (!next.includes(ACTIVE_SLOT_BINDING)) {
    next = next.replace(LEGACY_ACTIVE_SLOT_BINDING, ACTIVE_SLOT_BINDING);
  }
  if (!next.includes(ACTIVE_SLOT_BINDING)) {
    next = next.replace(HYDRO_SAMPLER_BINDING, `${HYDRO_SAMPLER_BINDING}\n${ACTIVE_SLOT_BINDING}`);
  }

  next = next.replace(
    /fn grass_cull\(@builtin\(global_invocation_id\) id: vec3<u32>\) \{\s*process_slot\(id\.x\);\s*\}/,
    `fn grass_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = active_slots[id.x];
  if (slot == ${ACTIVE_SLOT_SENTINEL}) { return; }
  process_slot(slot);
}`,
  );

  if (!next.includes("active_slots[id.x]") || next.includes("process_slot(id.x);")) {
    throw new Error("grass ring WGSL active-slot transform failed");
  }
  return next;
}
