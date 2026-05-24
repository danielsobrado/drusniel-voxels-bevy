// Procedural loading flame overlay.
//
// Converted from the user-provided Ashima simplex-noise GLSL fire effect.
// This shader is rendered as a Bevy UI material so it appears above the loading
// background and disappears with the loading overlay.

#import bevy_ui::ui_vertex_output::UiVertexOutput

struct LoadingFlamesUniform {
    time: f32,
    _time_padding: f32,
    resolution: vec2<f32>,
    mouse: vec2<f32>,
};

@group(1) @binding(0) var<uniform> loading_flames: LoadingFlamesUniform;

fn mod289(x: vec3<f32>) -> vec3<f32> {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn mod289_4(x: vec4<f32>) -> vec4<f32> {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}

fn permute(x: vec4<f32>) -> vec4<f32> {
    return mod289_4(((x * 34.0) + 1.0) * x);
}

fn taylor_inv_sqrt(r: vec4<f32>) -> vec4<f32> {
    return 1.79284291400159 - 0.85373472095314 * r;
}

fn snoise(v: vec3<f32>) -> f32 {
    let C = vec2<f32>(1.0 / 6.0, 1.0 / 3.0);
    let D = vec4<f32>(0.0, 0.5, 1.0, 2.0);

    var i = floor(v + dot(v, vec3<f32>(C.y)));
    let x0 = v - i + dot(i, vec3<f32>(C.x));
    i = mod289(i);

    let g = step(vec3<f32>(x0.y, x0.z, x0.x), x0);
    let l = 1.0 - g;
    let i1 = min(g, vec3<f32>(l.z, l.x, l.y));
    let i2 = max(g, vec3<f32>(l.z, l.x, l.y));

    let x1 = x0 - i1 + vec3<f32>(C.x);
    let x2 = x0 - i2 + vec3<f32>(C.y);
    let x3 = x0 - vec3<f32>(D.y);

    let p = permute(
        permute(
            permute(
                i.z + vec4<f32>(0.0, i1.z, i2.z, 1.0),
            )
            + i.y
            + vec4<f32>(0.0, i1.y, i2.y, 1.0),
        )
            + i.x
            + vec4<f32>(0.0, i1.x, i2.x, 1.0),
    );

    let n_ = 1.0 / 7.0;
    let ns = n_ * D.wyz - D.xzx;
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let x = x_ * ns.x + vec4<f32>(ns.y);
    let y = y_ * ns.x + vec4<f32>(ns.y);
    let h = 1.0 - abs(x) - abs(y);

    let b0 = vec4<f32>(x.x, x.y, y.x, y.y);
    let b1 = vec4<f32>(x.z, x.w, y.z, y.w);

    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4<f32>(0.0));
    let a0 = b0.xzyw + s0.xzyw * vec4<f32>(sh.x, sh.x, sh.y, sh.y);
    let a1 = b1.xzyw + s1.xzyw * vec4<f32>(sh.z, sh.z, sh.w, sh.w);

    let p0 = vec3<f32>(a0.x, a0.y, h.x);
    let p1 = vec3<f32>(a0.z, a0.w, h.y);
    let p2 = vec3<f32>(a1.x, a1.y, h.z);
    let p3 = vec3<f32>(a1.z, a1.w, h.w);

    let norm = taylor_inv_sqrt(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    let np0 = p0 * norm.x;
    let np1 = p1 * norm.y;
    let np2 = p2 * norm.z;
    let np3 = p3 * norm.w;

    let m = max(
        vec4<f32>(0.6) - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)),
        vec4<f32>(0.0),
    );
    let mm = m * m;
    return 42.0 * dot(
        mm * mm,
        vec4<f32>(dot(np0, x0), dot(np1, x1), dot(np2, x2), dot(np3, x3)),
    );
}

fn prng(seed: vec2<f32>) -> f32 {
    var seed = fract(seed * vec2<f32>(5.3983, 5.4427));
    seed = seed + dot(seed.yx, seed.xy + vec2<f32>(21.5351, 14.3137));
    return fract(seed.x * seed.y * 95.4337);
}

fn noise_stack(pos: vec3<f32>, octaves: i32, falloff: f32) -> f32 {
    var noise = snoise(pos);
    var off = 1.0;
    var p = pos;
    if (octaves > 1) {
        p = p * 2.0;
        off = off * falloff;
        noise = (1.0 - off) * noise + off * snoise(p);
    }
    if (octaves > 2) {
        p = p * 2.0;
        off = off * falloff;
        noise = (1.0 - off) * noise + off * snoise(p);
    }
    if (octaves > 3) {
        p = p * 2.0;
        off = off * falloff;
        noise = (1.0 - off) * noise + off * snoise(p);
    }
    return (1.0 + noise) * 0.5;
}

fn noise_stack_uv(pos: vec3<f32>, octaves: i32, falloff: f32, _diff: f32) -> vec2<f32> {
    let displace_a = noise_stack(pos, octaves, falloff);
    let displace_b = noise_stack(pos + vec3<f32>(3984.293, 423.21, 5235.19), octaves, falloff);
    return vec2<f32>(displace_a, displace_b);
}

@fragment
fn fragment(in: UiVertexOutput) -> @location(0) vec4<f32> {
    let resolution = max(loading_flames.resolution, vec2<f32>(1.0));
    let mouse = loading_flames.mouse;
    let time = loading_flames.time;

    let frag_coord = in.uv * resolution;
    let xpart = frag_coord.x / resolution.x;
    let ypart = frag_coord.y / resolution.y;
    let clip = 210.0;
    let ypart_clip = frag_coord.y / clip;
    let ypart_clipped_falloff = clamp(2.0 - ypart_clip, 0.0, 1.0);
    let ypart_clipped = min(ypart_clip, 1.0);
    let ypart_clipped_n = 1.0 - ypart_clipped;

    let xfuel = 1.0 - abs(2.0 * xpart - 1.0);
    let real_time = 0.5 * time;
    let coord_scaled = 0.01 * frag_coord - 0.02 * vec2<f32>(mouse.x, 0.0);
    let position = vec3<f32>(coord_scaled, 0.0) + vec3<f32>(1223.0, 6434.0, 8425.0);
    let flow = vec3<f32>(4.1 * (0.5 - xpart) * pow(ypart_clipped_n, 4.0), -2.0 * xfuel * pow(ypart_clipped_n, 64.0), 0.0);
    let timing = real_time * vec3<f32>(0.0, -1.7, 1.1) + flow;

    let displace_pos = vec3<f32>(1.0, 0.5, 1.0) * 2.4 * position + real_time * vec3<f32>(0.01, -0.7, 1.3);
    let displace3 = noise_stack_uv(displace_pos, 2, 0.4, 0.1);
    let noise_coord = (vec3<f32>(2.0, 1.0, 1.0) * position + timing + 0.4 * vec3<f32>(displace3.x, displace3.y, 0.0));
    let noise = noise_stack(noise_coord, 3, 0.4);

    let flames = pow(ypart_clipped, 0.3 * xfuel) * pow(noise, 0.3 * xfuel);
    let f = ypart_clipped_falloff * pow(1.0 - flames * flames * flames, 8.0);
    let fff = f * f * f;
    let fire = 1.5 * vec3<f32>(f, fff, fff * fff);

    let smoke_noise = 0.5 + snoise(0.4 * position + timing * vec3<f32>(1.0, 1.0, 0.2)) * 0.5;
    let smoke = vec3<f32>(0.3 * pow(xfuel, 3.0) * pow(ypart, 2.0) * (smoke_noise + 0.4 * (1.0 - noise)));

    let spark_grid_size = 30.0;
    var spark_coord = frag_coord - vec2<f32>(2.0 * mouse.x, 190.0 * real_time);
    spark_coord -= 30.0 * noise_stack_uv(vec3<f32>(spark_coord, 30.0 * time), 1, 0.4, 0.1);
    spark_coord += 100.0 * flow.xy;
    if (fract((spark_coord.y / spark_grid_size) * 0.5) < 0.5) {
        spark_coord.x += 0.5 * spark_grid_size;
    }
    let spark_grid_index = floor(spark_coord / spark_grid_size);
    let spark_random = prng(vec2<f32>(spark_grid_index.x, spark_grid_index.y));
    let spark_life = min(
        10.0 * (1.0 - min(
            (spark_grid_index.y + (190.0 * real_time / spark_grid_size)) / (24.0 - 20.0 * spark_random),
            1.0,
        )),
        1.0,
    );

    var sparks = vec3<f32>(0.0);
    if (spark_life > 0.0) {
        let spark_size = xfuel * xfuel * spark_random * 0.08;
        let spark_radians = 999.0 * spark_random * 2.0 * 3.141592653589793 + 2.0 * time;
        let spark_circular = vec2<f32>(sin(spark_radians), cos(spark_radians));
        let spark_offset = (0.5 - spark_size) * spark_grid_size * spark_circular;
        let spark_modulus = mod((spark_coord + spark_offset), vec2<f32>(spark_grid_size)) - 0.5 * vec2<f32>(spark_grid_size);
        let spark_length = length(spark_modulus);
        let sparks_gray = max(
            0.0,
            1.0 - spark_length / (spark_size * spark_grid_size),
        );
        sparks = spark_life * sparks_gray * vec3<f32>(1.0, 0.3, 0.0);
    }

    let flame_source = max(fire, sparks) + smoke;
    let flame_luma = max(max(flame_source.r, flame_source.g), flame_source.b);
    let alpha = clamp(0.18 + flame_luma * 1.25, 0.0, 0.96);
    return vec4<f32>(flame_source * vec3<f32>(1.8, 1.35, 1.1), alpha);
}
