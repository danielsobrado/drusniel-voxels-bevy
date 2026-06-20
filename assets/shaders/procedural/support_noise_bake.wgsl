// Shared contract for baked support noise maps.
// Runtime generation currently happens on CPU; this include keeps the GPU bake
// layout explicit for a later compute path.

struct SupportNoiseSample {
    noise_a: vec4<f32>, // value, fbm, fbm_dx, fbm_dz
    noise_b: vec4<f32>, // ridged_dx, ridged_dz, ridged, worley_f1
};
