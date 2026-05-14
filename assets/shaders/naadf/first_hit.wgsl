#import "shaders/naadf/ray_trace.wgsl"

fn trace_naadf_first_hit(ray: NaadfRay) -> NaadfHit {
    return trace_naadf(ray, 5u);
}
