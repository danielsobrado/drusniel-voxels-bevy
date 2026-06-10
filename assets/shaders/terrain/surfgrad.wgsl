// Surface-gradient helpers for hextiled normal maps (Mikkelsen / mmikk surfgrad_framework.h).
// MIT license — see docs/rendering/terrain-hex-tiling.md.

fn tspace_normal_to_derivative(tangent_normal: vec3<f32>) -> vec2<f32> {
    let v_ma = abs(tangent_normal);
    let z_ma = max(v_ma.z, max(v_ma.x, v_ma.y) / 128.0);
    return -vec2<f32>(tangent_normal.x, -tangent_normal.y) / z_ma;
}

fn surfgrad_from_volume_gradient(grad: vec3<f32>, base_normal: vec3<f32>) -> vec3<f32> {
    return grad - dot(base_normal, grad) * base_normal;
}

// Triplanar volume gradient from per-plane height derivatives.
// Drusniel planes: yz (weight.x), xz (weight.y), xy (weight.z).
fn surfgrad_from_triplanar_projection(
    triplanar_weights: vec3<f32>,
    deriv_yz: vec2<f32>,
    deriv_xz: vec2<f32>,
    deriv_xy: vec2<f32>,
    base_normal: vec3<f32>,
) -> vec3<f32> {
    let grad = vec3<f32>(
        triplanar_weights.z * deriv_xy.x + triplanar_weights.y * deriv_xz.x,
        triplanar_weights.z * deriv_xy.y + triplanar_weights.x * deriv_yz.y,
        triplanar_weights.x * deriv_yz.x + triplanar_weights.y * deriv_xz.y,
    );
    return surfgrad_from_volume_gradient(grad, base_normal);
}

fn resolve_normal_from_surface_gradient(
    base_normal: vec3<f32>,
    surf_grad: vec3<f32>,
    normal_intensity: f32,
) -> vec3<f32> {
    return normalize(base_normal - surf_grad * normal_intensity);
}
