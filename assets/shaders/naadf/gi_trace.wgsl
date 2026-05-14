#import "shaders/naadf/ray_trace.wgsl"

fn trace_naadf_gi(ray: NaadfRay) -> NaadfHit {
    return trace_naadf(ray, 2u);
}
