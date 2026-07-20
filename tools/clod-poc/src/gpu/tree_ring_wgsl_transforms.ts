export function withTreeFinalPlacementHeight(source: string): string {
  return source
    .replace("let sample_ground_height = surfaceHeightField(sample_xz.x, sample_xz.y);", "let sample_ground_height = placement_ground_height(sample_xz.x, sample_xz.y, params.center_radius.w);")
    .replace("let raw_height = surfaceHeightField(wpos.x, wpos.y);", "let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);")
    .replace("let height = tree_hydrology_ground_height(raw_height, hydro);", "let height = raw_height;")
    .replace("let start_height = surfaceHeightField(start_xz.x, start_xz.y) + 18.0;", "let start_height = params.settings_e.w;");
}

export function withTreeTerrainVisibilityCull(source: string): string {
  let next = source.replace(/\r\n/g, "\n");
  if (!next.includes("var<storage, read> tree_visible_cluster_mask: array<u32>;")) {
    next = next.replace(
      "fn tree_terrain_visibility_enabled() -> bool {",
      "@group(0) @binding(11) var<storage, read> tree_visible_cluster_mask: array<u32>;\n@group(0) @binding(12) var<storage, read> tree_active_slot_indices: array<u32>;\n\nfn tree_terrain_visibility_enabled() -> bool {",
    );
  } else if (!next.includes("var<storage, read> tree_active_slot_indices: array<u32>;")) {
    next = next.replace(
      "@group(0) @binding(11) var<storage, read> tree_visible_cluster_mask: array<u32>;",
      "@group(0) @binding(11) var<storage, read> tree_visible_cluster_mask: array<u32>;\n@group(0) @binding(12) var<storage, read> tree_active_slot_indices: array<u32>;",
    );
  }
  if (!next.includes("fn tree_terrain_visibility_enabled()")) {
    next = next.replace(
      "fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {",
      "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}\n\nfn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {",
    );
  }
  if (!next.includes("fn tree_slot_visible_cluster_visible(slot: u32) -> bool")) {
    const visibleClusterHelper = "fn tree_slot_visible_cluster_visible(slot: u32) -> bool {\n  let cluster_grid = params.terrain_visibility_u.w;\n  if (cluster_grid == 0u) { return true; }\n  let cluster_dim = max(1u, params.terrain_visibility_u.z);\n  let grid = max(1u, params.settings_u.y);\n  let slot_x = slot % grid;\n  let slot_z = slot / grid;\n  let cluster_x = min(cluster_grid - 1u, slot_x / cluster_dim);\n  let cluster_z = min(cluster_grid - 1u, slot_z / cluster_dim);\n  return tree_visible_cluster_mask[cluster_z * cluster_grid + cluster_x] != 0u;\n}";
    next = next.replace(
      /fn tree_terrain_visibility_enabled\(\) -> bool \{\r?\n  return params\.terrain_visibility\.x > 0\.5;\r?\n\}/,
      "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}\n\n" + visibleClusterHelper,
    );
    if (!next.includes("fn tree_slot_visible_cluster_visible(slot: u32) -> bool")) {
      next = next.replace("fn tree_terrain_debug_counts_enabled() -> bool {", `${visibleClusterHelper}\n\nfn tree_terrain_debug_counts_enabled() -> bool {`);
    }
  }

  const visibleAppendFn = "append_" + "lod_if_active";
  const shadowAppendFn = "append_" + "shadow_lod_if_active";
  const terrainRejectStmt = "if (terrain_" + "hidden) { return; }";
  const clusterRejectStmt = "if (!tree_slot_visible_cluster_visible(slot)) { return; }";
  const targetOrder = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  var terrain_hidden = false;
  if (tree_terrain_visibility_enabled()) {
    terrain_hidden = terrain_ridge_filter(wpos, height, dist);
    record_tree_terrain_visibility(terrain_hidden);
  }
  ${terrainRejectStmt}
  ${shadowAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);
  ${clusterRejectStmt}
  if (!in_frustum(shadow_center, 8.0)) { return; }
  ${visibleAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, wc, height, scale);`;
  const shadowsBeforeTerrainOrder = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  var terrain_hidden = false;
  if (tree_terrain_visibility_enabled()) {
    terrain_hidden = terrain_ridge_filter(wpos, height, dist);
    record_tree_terrain_visibility(terrain_hidden);
  }
  ${shadowAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);
  ${terrainRejectStmt}
  if (!in_frustum(shadow_center, 8.0)) { return; }
  ${visibleAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, wc, height, scale);`;
  const terrainAndClusterBeforeShadowsOrder = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  var terrain_hidden = false;
  if (tree_terrain_visibility_enabled()) {
    terrain_hidden = terrain_ridge_filter(wpos, height, dist);
    record_tree_terrain_visibility(terrain_hidden);
  }
  ${terrainRejectStmt}
  ${clusterRejectStmt}
  ${shadowAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);
  if (!in_frustum(shadow_center, 8.0)) { return; }
  ${visibleAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, wc, height, scale);`;
  const terrainBeforeShadowsNoClusterOrder = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  var terrain_hidden = false;
  if (tree_terrain_visibility_enabled()) {
    terrain_hidden = terrain_ridge_filter(wpos, height, dist);
    record_tree_terrain_visibility(terrain_hidden);
  }
  ${terrainRejectStmt}
  ${shadowAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);
  if (!in_frustum(shadow_center, 8.0)) { return; }
  ${visibleAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, wc, height, scale);
  ${visibleAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, wc, height, scale);`;

  next = next
    .replace(shadowsBeforeTerrainOrder, targetOrder)
    .replace(terrainAndClusterBeforeShadowsOrder, targetOrder)
    .replace(terrainBeforeShadowsNoClusterOrder, targetOrder);
  if (!next.includes(clusterRejectStmt)) {
    next = next.replace(
      `  ${shadowAppendFn}(species, shadow_lod, 1u, shadow_center, wc, height, scale);\n  if (!in_frustum(shadow_center, 8.0)) { return; }`,
      `  ${shadowAppendFn}(species, shadow_lod, 1u, shadow_center, wc, height, scale);\n  ${clusterRejectStmt}\n  if (!in_frustum(shadow_center, 8.0)) { return; }`,
    );
  }
  if (!next.includes("terrain_ridge_filter(wpos, height, dist)")) {
    next = next.replace(
      `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  ${shadowAppendFn}(species, TREE_LOD_NEAR, ring.lod_active.x, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_MID, ring.lod_active.y, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_FAR, ring.lod_active.z, shadow_center, wc, height, scale);
  ${shadowAppendFn}(species, TREE_LOD_IMPOSTOR, ring.lod_active.w, shadow_center, wc, height, scale);`,
      targetOrder,
    );
  }
  return withTreeActiveSlotList(next);
}

export function withTreePcgHash(source: string): string {
  return source.replace(
    /fn tree_hash\(cell: vec2<f32>, salt: u32\) -> f32 \{[\s\S]*?\r?\n\}\r?\n\r?\nfn tree_hash2\(cell: vec2<f32>, salt: u32\) -> vec2<f32> \{[\s\S]*?\r?\n\}/,
    `fn tree_hash(cell: vec2<f32>, salt: u32) -> f32 {
  return tree_pcg2d(cell, params.settings_u.z + salt).x;
}

fn tree_hash2(cell: vec2<f32>, salt: u32) -> vec2<f32> {
  return tree_pcg2d(cell, params.settings_u.z + salt);
}`,
  );
}

export function withTreeSharedPcgModule(source: string): string {
  let next = source.replace(/\r\n/g, "\n");
  for (const name of [
    "VEGETATION_SCHEMA_VERSION",
    "VEGETATION_TREE_CATEGORY",
    "VEGETATION_DOMAIN_CHANNEL",
    "VEGETATION_IDENTITY_CHANNEL",
  ]) {
    next = next.replace(new RegExp(`const ${name}: u32 = [^;]+;\\n`), "");
  }
  next = next.replace(
    /fn tree_pcg2d\(cell: vec2<f32>, salt: u32\) -> vec2<f32> \{[\s\S]*?\n\}\n\nfn tree_pcg2d_u32\(cell: vec2<i32>, salt: u32\) -> vec2<u32> \{[\s\S]*?\n\}/,
    `fn tree_pcg2d(cell: vec2<f32>, salt: u32) -> vec2<f32> {
  return treePcg2d01(i32(cell.x), i32(cell.y), salt);
}

fn tree_pcg2d_u32(cell: vec2<i32>, salt: u32) -> vec2<u32> {
  return treePcg2dU32(cell.x, cell.y, salt);
}`,
  );
  next = next.replace(
    /fn vegetation_tree_identity\(cell: vec2<i32>, species: u32\) -> vec2<u32> \{[\s\S]*?\n\}/,
    `fn vegetation_tree_identity(cell: vec2<i32>, species: u32) -> vec2<u32> {
  return vegetationStableIdentity(
    params.settings_u.z,
    VEGETATION_TREE_CATEGORY,
    VEGETATION_SCHEMA_VERSION,
    cell,
    species,
  );
}`,
  );
  if (!next.includes("return treePcg2d01(i32(cell.x), i32(cell.y), salt);")
    || !next.includes("return treePcg2dU32(cell.x, cell.y, salt);")
    || !next.includes("return vegetationStableIdentity(")) {
    throw new Error("tree ring WGSL shared PCG transform failed");
  }
  return next;
}

export function withTreeCrownProxyShadowIndexCount(source: string, indexCount: number): string {
  const safeIndexCount = Math.max(0, Math.floor(indexCount));
  const helper = `fn shadow_index_count_for_group(group: u32) -> u32 {
  let visible_group = group % TREE_GROUP_COUNT;
  let lod = visible_group % TREE_LOD_COUNT;
  if (lod >= TREE_LOD_FAR) { return ${safeIndexCount}u; }
  return index_count_for_group(visible_group);
}`;
  let next = source.replace("fn in_frustum(center: vec3<f32>, slack: f32) -> bool {", `${helper}\n\nfn in_frustum(center: vec3<f32>, slack: f32) -> bool {`);
  next = next.replace(
    "shadow_indirect_args[base + 0u] = index_count_for_group(group % TREE_GROUP_COUNT);",
    "shadow_indirect_args[base + 0u] = shadow_index_count_for_group(group);",
  );
  if (!next.includes(`if (lod >= TREE_LOD_FAR) { return ${safeIndexCount}u; }`)
    || !next.includes("shadow_index_count_for_group(group)")) {
    throw new Error("tree ring WGSL crown-proxy shadow index transform failed");
  }
  return next;
}

export function withTreeShadowLodGate(source: string): string {
  return source.replace(
    "if (lod_active == 0u || params.settings_u.w == 0u) { return; }",
    `if (lod_active == 0u || params.settings_u.w == 0u) { return; }
  let max_shadow_lod = params.settings_e.z;
  if (max_shadow_lod < 0.0 || f32(lod) > max_shadow_lod) { return; }`,
  );
}

function withTreeActiveSlotList(source: string): string {
  const next = source.replace(
    /fn tree_cull\(@builtin\(global_invocation_id\) id: vec3<u32>\) \{\r?\n  process_tree_slot\(id\.x\);\r?\n\}/,
    `fn tree_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = tree_active_slot_indices[id.x];
  if (slot == 0xffffffffu) { return; }
  process_tree_slot(slot);
}`,
  );
  if (!next.includes("tree_active_slot_indices[id.x]") || next.includes("process_tree_slot(id.x);")) {
    throw new Error("tree ring WGSL active-slot transform failed");
  }
  return next;
}
