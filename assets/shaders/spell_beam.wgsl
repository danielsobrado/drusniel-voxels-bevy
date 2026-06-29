#import bevy_pbr::forward_io::VertexOutput

struct SpellBeamUniforms {
    // x = spell kind, y = elapsed seconds, z = progress, w = opacity scale
    params: vec4<f32>,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: SpellBeamUniforms;

fn hash(n: f32) -> f32 {
    return fract(sin(n) * 753.5453123);
}

fn noise(p: vec3<f32>, seed: f32) -> f32 {
    let i = floor(p);
    let f0 = fract(p);
    let f = f0 * f0 * (vec3<f32>(3.0) - 2.0 * f0);
    let n = i.x + i.y * 157.0 + i.z * 113.0 + seed;
    return mix(
        mix(
            mix(hash(n + 0.0), hash(n + 1.0), f.x),
            mix(hash(n + 157.0), hash(n + 158.0), f.x),
            f.y,
        ),
        mix(
            mix(hash(n + 113.0), hash(n + 114.0), f.x),
            mix(hash(n + 270.0), hash(n + 271.0), f.x),
            f.y,
        ),
        f.z,
    );
}

fn fbm(p0: vec3<f32>, seed: f32, mul: f32, offset: vec3<f32>) -> f32 {
    var p = p0;
    var value = 0.0;
    var amp = 0.5;
    for (var i = 0u; i < 5u; i = i + 1u) {
        value += noise(p, seed) * amp;
        p = p * mul + offset;
        amp *= 0.5;
    }
    return value;
}

fn ring(d: f32, radius: f32, thickness: f32) -> f32 {
    return 1.0 - smoothstep(thickness, thickness * 2.0, abs(d - radius));
}

fn spell_color(kind: f32, stream: f32, core: f32, glow: f32, sparks: f32) -> vec3<f32> {
    if (kind < 0.5) {
        var color = mix(vec3<f32>(0.85, 0.12, 0.025), vec3<f32>(1.0, 0.42, 0.07), stream);
        color = mix(color, vec3<f32>(1.0, 0.88, 0.36), core);
        return color + vec3<f32>(1.0, 0.37, 0.12) * glow + vec3<f32>(1.0, 0.55, 0.12) * sparks;
    }
    if (kind < 1.5) {
        var color = mix(vec3<f32>(0.02, 0.24, 0.50), vec3<f32>(0.05, 0.62, 0.95), stream);
        color = mix(color, vec3<f32>(0.72, 0.96, 1.0), core);
        return color + vec3<f32>(0.30, 0.86, 1.0) * glow + vec3<f32>(0.72, 0.96, 1.0) * sparks;
    }
    var color = mix(vec3<f32>(0.13, 0.25, 0.30), vec3<f32>(0.68, 0.93, 1.0), stream);
    color = mix(color, vec3<f32>(0.90, 0.99, 1.0), core);
    return color + vec3<f32>(0.90, 0.99, 1.0) * glow + vec3<f32>(0.80, 0.76, 0.56) * sparks;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let kind = uniforms.params.x;
    let time = uniforms.params.y;
    let progress = clamp(uniforms.params.z, 0.0, 1.0);
    let opacity = uniforms.params.w;
    let uv = in.uv;
    let side = uv.x - 0.5;
    let t = uv.y;
    let p = vec2<f32>(side, uv.y - 0.5);

    let cast_in = smoothstep(0.0, select(0.08, 0.055, kind > 1.5), progress);
    let cast_out = 1.0 - smoothstep(select(0.78, 0.72, kind > 1.5), 1.0, progress);
    let life = cast_in * cast_out;
    let grow = smoothstep(0.0, select(0.24, 0.18, kind > 1.5), progress);

    let seed = select(select(753.545, 43758.545, kind > 0.5), 92831.73, kind > 1.5);
    let freq_mul = select(select(2.03, 2.02, kind > 0.5), 2.07, kind > 1.5);
    let offset = select(select(vec3<f32>(13.7, 7.1, 4.8), vec3<f32>(9.7, 5.1, 12.4), kind > 0.5), vec3<f32>(4.2, 17.3, 8.9), kind > 1.5);
    let flow = fbm(vec3<f32>(t * select(2.2, 3.1, kind > 1.5), time * select(1.7, 2.8, kind > 1.5), 5.0), seed, freq_mul, offset);
    let gust = sin(t * select(28.0, 42.0, kind > 1.5) - time * select(18.0, 28.0, kind > 1.5) + flow * 5.0) * select(0.018, 0.027, kind > 1.5);
    let warped_side = side + (flow - 0.5) * select(0.11, 0.085, kind > 1.5) * smoothstep(0.06, 0.86, t) + select(gust, 0.0, kind < 0.5);
    let path_mask = smoothstep(-0.02, 0.08, t) * (1.0 - smoothstep(grow * 0.96, grow * 1.16 + 0.01, t));

    let base_width = select(select(0.035, 0.035, kind > 0.5), 0.045, kind > 1.5);
    let tip_width = select(select(0.255, 0.18, kind > 0.5), 0.205, kind > 1.5);
    var beam_width = mix(base_width, tip_width, pow(max(t, 0.0), select(0.74, 0.72, kind > 1.5)));
    beam_width *= 1.0 - smoothstep(0.68, 1.06, t) * select(0.58, 0.42, kind > 1.5);
    beam_width = max(beam_width, 0.018);

    let q = vec3<f32>(warped_side / beam_width, t * 3.4, time * 2.6);
    let body_noise = fbm(q * vec3<f32>(1.0, 1.7, 1.0) + vec3<f32>(0.0, time * -4.2, 2.0), seed, freq_mul, offset);
    let fine_noise = fbm(q * vec3<f32>(2.4, 3.2, 1.0) + vec3<f32>(8.0, time * -7.0, 4.0), seed, freq_mul, offset);
    let body = 1.0 - abs(warped_side) / beam_width - t * select(0.46, 0.24, kind > 1.5) + body_noise * select(0.68, 0.34, kind > 1.5) + fine_noise * 0.12;
    let stream = smoothstep(0.08, 0.82, body) * path_mask * life;
    let core = smoothstep(0.60, 1.20, body + (1.0 - t) * 0.22) * path_mask * life;

    let hand_dist = length(vec2<f32>(side * 0.72, t * 1.30));
    let hand_glow = (1.0 - smoothstep(0.04, 0.27, hand_dist)) * life;
    let rings = (ring(hand_dist, 0.145 + sin(time * 7.0) * 0.016, 0.010)
        + ring(hand_dist, 0.22 + sin(time * 4.2) * 0.020, 0.008) * 0.55) * life;
    let cell = floor(vec2<f32>((warped_side + 0.55) * 94.0, t * 82.0));
    let sparks = step(0.987, noise(vec3<f32>(cell.x, cell.y, floor(time * 32.0)), seed))
        * smoothstep(0.12, 0.96, t)
        * (1.0 - smoothstep(1.0, 1.14, t))
        * life;

    let color = spell_color(kind, stream, core, hand_glow * 0.45 + rings * 0.80, sparks * 0.65);
    let alpha_max = select(select(0.96, 0.88, kind > 0.5), 0.62, kind > 1.5);
    let alpha = clamp(stream * 0.62 + core * 0.32 + hand_glow * 0.30 + rings * 0.42 + sparks * 0.30, 0.0, alpha_max) * opacity;
    if (alpha <= 0.002) {
        discard;
    }
    return vec4<f32>(color, alpha);
}
