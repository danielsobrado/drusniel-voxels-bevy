#define_import_path noise::noise_utils

// Hash functions
fn hash_3d(p: vec3<f32>) -> f32 {
    let p3 = fract(p * 0.1031);
    let p3_mod = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3_mod.x + p3_mod.y) * p3_mod.z);
}

// 3D Gradient Noise (simpler/faster than Perlin)
fn noise_3d(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);

    // Quintic interpolation (smoother)
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    let n = i.x + i.y * 157.0 + 113.0 * i.z;

    let a = hash_3d(i + vec3<f32>(0.0, 0.0, 0.0));
    let b = hash_3d(i + vec3<f32>(1.0, 0.0, 0.0));
    let c = hash_3d(i + vec3<f32>(0.0, 1.0, 0.0));
    let d = hash_3d(i + vec3<f32>(1.0, 1.0, 0.0));
    let e = hash_3d(i + vec3<f32>(0.0, 0.0, 1.0));
    let fr = hash_3d(i + vec3<f32>(1.0, 0.0, 1.0));
    let g = hash_3d(i + vec3<f32>(0.0, 1.0, 1.0));
    let h = hash_3d(i + vec3<f32>(1.0, 1.0, 1.0));

    let k0 = a;
    let k1 = b - a;
    let k2 = c - a;
    let k3 = e - a;
    let k4 = a - b - c + d;
    let k5 = a - c - e + g;
    let k6 = a - b - e + fr;
    let k7 = -a + b + c - d + e - fr - g + h;

    return k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
}

// Fractal Brownian Motion
fn fbm_3d(p: vec3<f32>, octaves: u32, lacunarity: f32, gain: f32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;

    for (var i: u32 = 0u; i < octaves; i = i + 1u) {
        value = value + amplitude * noise_3d(pos);
        pos = pos * lacunarity;
        amplitude = amplitude * gain;
    }
    return value;
}

// Domain Warping
fn domain_warp(p: vec3<f32>, octaves: u32) -> f32 {
    let q = vec3<f32>(
        fbm_3d(p + vec3<f32>(0.0, 0.0, 0.0), octaves, 2.0, 0.5),
        fbm_3d(p + vec3<f32>(5.2, 1.3, 2.8), octaves, 2.0, 0.5),
        fbm_3d(p + vec3<f32>(1.7, 9.2, 0.5), octaves, 2.0, 0.5)
    );

    let r = vec3<f32>(
        fbm_3d(p + 4.0 * q + vec3<f32>(1.7, 9.2, 5.2), octaves, 2.0, 0.5),
        fbm_3d(p + 4.0 * q + vec3<f32>(8.3, 2.8, 1.1), octaves, 2.0, 0.5),
        fbm_3d(p + 4.0 * q + vec3<f32>(1.2, 3.4, 5.6), octaves, 2.0, 0.5)
    );

    return fbm_3d(p + 4.0 * r, octaves, 2.0, 0.5);
}
