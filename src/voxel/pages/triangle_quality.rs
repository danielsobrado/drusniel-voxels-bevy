const EPS: f32 = 1e-12;

pub type Vec3 = [f32; 3];

pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn length(a: Vec3) -> f32 {
    dot(a, a).sqrt()
}

pub fn normalize(a: Vec3) -> Option<Vec3> {
    let len = length(a);
    if !len.is_finite() || len <= EPS {
        return None;
    }
    Some([a[0] / len, a[1] / len, a[2] / len])
}

pub fn triangle_area(a: Vec3, b: Vec3, c: Vec3) -> f32 {
    length(cross(sub(b, a), sub(c, a))) * 0.5
}

pub fn triangle_normal(a: Vec3, b: Vec3, c: Vec3) -> Option<Vec3> {
    normalize(cross(sub(b, a), sub(c, a)))
}

pub fn triangle_min_angle_degrees(a: Vec3, b: Vec3, c: Vec3) -> f32 {
    let ab = length(sub(b, a));
    let bc = length(sub(c, b));
    let ca = length(sub(a, c));
    if ab <= EPS || bc <= EPS || ca <= EPS {
        return 0.0;
    }
    let angle_a = angle_degrees(ab, ca, bc);
    let angle_b = angle_degrees(ab, bc, ca);
    let angle_c = 180.0 - angle_a - angle_b;
    angle_a.min(angle_b).min(angle_c)
}

pub fn finite_vec3(v: Vec3) -> bool {
    v[0].is_finite() && v[1].is_finite() && v[2].is_finite()
}

pub fn material_distance_squared(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| {
            let d = x - y;
            d * d
        })
        .sum()
}

fn angle_degrees(side_a: f32, side_b: f32, opposite: f32) -> f32 {
    let denom = 2.0 * side_a * side_b;
    if denom <= EPS {
        return 0.0;
    }
    let cos = ((side_a * side_a + side_b * side_b - opposite * opposite) / denom).clamp(-1.0, 1.0);
    cos.acos().to_degrees()
}
