#import "shaders/naadf/layout.wgsl"

struct NaadfRay {
    origin: vec3<f32>,
    direction: vec3<f32>,
};

struct NaadfHit {
    hit: u32,
    distance: f32,
    material_id: u32,
    steps: u32,
};

fn trace_naadf(_ray: NaadfRay, _purpose: u32) -> NaadfHit {
    return NaadfHit(0u, 0.0, 0u, 0u);
}
