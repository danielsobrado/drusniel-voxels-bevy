#[test]
fn non_dynamic_water_shader_does_not_sink_vertices() {
    let shader = include_str!("../assets/shaders/water_vertex.wgsl");

    assert!(
        shader.contains("var height = 0.0;"),
        "non-DYN_WATER vertex path should keep water at mesh height"
    );
    assert!(
        !shader.contains("var height = -0.5;"),
        "non-DYN_WATER vertex path must not sink shore water below the mesh"
    );
}
