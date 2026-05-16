#import "shaders/naadf/first_hit.wgsl"

fn shade_naadf_preview(hit: NaadfHit) -> vec3<f32> {
    if hit.hit == 0u {
        return vec3<f32>(0.0);
    }
    return naadf_preview_shaded_color(hit.material_id, hit.normal);
}
