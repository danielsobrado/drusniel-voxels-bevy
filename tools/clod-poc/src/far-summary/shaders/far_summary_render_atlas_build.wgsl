fn renderAtlasMaterialColor(material: u32) -> vec3<f32> {
  switch material % 5u {
    case 0u: { return vec3<f32>(0.76, 0.70, 0.50); }
    case 1u: { return vec3<f32>(0.30, 0.48, 0.24); }
    case 2u: { return vec3<f32>(0.42, 0.34, 0.24); }
    case 3u: { return vec3<f32>(0.50, 0.47, 0.42); }
    default: { return vec3<f32>(0.85, 0.88, 0.95); }
  }
}

@compute @workgroup_size(64)
fn build_far_summary_render_atlas(@builtin(global_invocation_id) id: vec3<u32>) {
  let tileIndex = id.x;
  if (tileIndex >= arrayLength(&descriptors)) {
    return;
  }

  let descriptor = descriptors[tileIndex];
  let tileCells = max(1u, descriptor.tile_cells);
  let cellM = descriptor.cell_size_m;
  let atlasOrigin = vec2<u32>(descriptor.layout_version, descriptor.canonical_sample_offset);

  for (var sz: u32 = 0u; sz < tileCells; sz = sz + 1u) {
    for (var sx: u32 = 0u; sx < tileCells; sx = sx + 1u) {
      let wx = descriptor.origin_x + (f32(sx) + 0.5) * cellM;
      let wz = descriptor.origin_z + (f32(sz) + 0.5) * cellM;
      let h = surfaceHeightField(wx, wz);
      let hL = surfaceHeightField(descriptor.origin_x + (f32(max(i32(sx) - 1, -1)) + 0.5) * cellM, wz);
      let hR = surfaceHeightField(descriptor.origin_x + (f32(min(i32(sx) + 1, i32(tileCells))) + 0.5) * cellM, wz);
      let hD = surfaceHeightField(wx, descriptor.origin_z + (f32(max(i32(sz) - 1, -1)) + 0.5) * cellM);
      let hU = surfaceHeightField(wx, descriptor.origin_z + (f32(min(i32(sz) + 1, i32(tileCells))) + 0.5) * cellM);
      let sampleMin = min(h, min(hL, min(hR, min(hD, hU))));
      let sampleMax = max(h, max(hL, max(hR, max(hD, hU))));
      let normal = normalFromHeightsField(hL, hR, hD, hU, cellM);
      let material = classifyBiomeMaterial(wx, wz, h);
      let water = select(0.0, 1.0, sampleMax < fieldParams.seaLevel);
      let atlasCoord = vec2<i32>(atlasOrigin + vec2<u32>(sx, sz));

      textureStore(render_height_atlas, atlasCoord, vec4<f32>(h, sampleMin, sampleMax, 1.0));
      textureStore(render_material_atlas, atlasCoord, vec4<f32>(renderAtlasMaterialColor(material), 1.0));
      textureStore(render_normal_atlas, atlasCoord, vec4<f32>(normal * 0.5 + 0.5, 1.0));
      textureStore(render_coverage_atlas, atlasCoord, vec4<f32>(0.0, water, 0.0, 1.0));
    }
  }
}
