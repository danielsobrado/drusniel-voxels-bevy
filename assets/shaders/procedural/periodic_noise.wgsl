fn procedural_hash_2d(p: vec2<f32>) -> f32 {
    let q = vec2<f32>(
        dot(p, vec2<f32>(127.1, 311.7)),
        dot(p, vec2<f32>(269.5, 183.3)),
    );
    return fract(sin(q.x + q.y) * 43758.5453);
}

fn procedural_value_noise_2d(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = procedural_hash_2d(i);
    let b = procedural_hash_2d(i + vec2<f32>(1.0, 0.0));
    let c = procedural_hash_2d(i + vec2<f32>(0.0, 1.0));
    let d = procedural_hash_2d(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn procedural_fbm_2d(p: vec2<f32>) -> f32 {
    var amp = 0.5;
    var freq = 1.0;
    var sum = 0.0;
    var norm = 0.0;
    for (var i = 0; i < 4; i = i + 1) {
        sum = sum + procedural_value_noise_2d(p * freq + vec2<f32>(f32(i) * 17.13, f32(i) * -9.71)) * amp;
        norm = norm + amp;
        amp = amp * 0.5;
        freq = freq * 2.02;
    }
    return sum / max(norm, 0.0001);
}
