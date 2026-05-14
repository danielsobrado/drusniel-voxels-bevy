#import "shaders/naadf/layout.wgsl"

@compute @workgroup_size(4, 4, 4)
fn build_naadf_blocks(@builtin(global_invocation_id) _id: vec3<u32>) {
}
