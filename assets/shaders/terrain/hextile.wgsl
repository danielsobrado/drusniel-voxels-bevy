// Practical Real-Time Hex-Tiling (albedo + normal paths), ported from
// mmikk/hextile-demo `hextiling.h` (the non-RWS form the demo actually ships).
// MIT license — see docs/rendering/terrain-hex-tiling.md.

#import "shaders/terrain/surfgrad.wgsl"::{tspace_normal_to_derivative}

const HEX_SQRT3: f32 = 1.7320508075688772;
const HEX_GRID_SCALE: f32 = 2.0 * HEX_SQRT3;
const HEX_FALLOFF_CONTRAST: f32 = 0.6;
const HEX_WEIGHT_EXP: f32 = 7.0;
const HEX_LUM_WEIGHT: vec3<f32> = vec3<f32>(0.299, 0.587, 0.114);
const HEX_PI: f32 = 3.14159265;
const HEX_TWO_PI: f32 = 6.2831853;

const HEX_GRID_TO_SKEW: mat2x2<f32> = mat2x2<f32>(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(-0.57735027, 1.15470054),
);
// Inverse of HEX_GRID_TO_SKEW (mmikk `invSkewMat`). WGSL builds the matrix
// column-major, so the columns below give rows (1, 0.5) / (0, 0.8660254).
const HEX_INV_SKEW: mat2x2<f32> = mat2x2<f32>(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.5, 0.8660254037844386),
);

struct HexTriangleGrid {
    w1: f32,
    w2: f32,
    w3: f32,
    vertex1: vec2<i32>,
    vertex2: vec2<i32>,
    vertex3: vec2<i32>,
}

fn hash_2d(p: vec2<f32>) -> vec2<f32> {
    let r = vec2<f32>(
        127.1 * p.x + 311.7 * p.y,
        269.5 * p.x + 183.3 * p.y,
    );
    return fract(sin(r) * 43758.5453);
}

fn make_center_st(vertex: vec2<i32>) -> vec2<f32> {
    return (HEX_INV_SKEW * vec2<f32>(f32(vertex.x), f32(vertex.y))) / HEX_GRID_SCALE;
}

fn load_rotation_2x2(idx: vec2<i32>, rot_strength: f32) -> mat2x2<f32> {
    var angle = f32(abs(idx.x * idx.y) + abs(idx.x + idx.y)) + HEX_PI;
    angle = angle - floor(angle / HEX_TWO_PI) * HEX_TWO_PI;
    if (angle > HEX_PI) {
        angle = angle - HEX_TWO_PI;
    }
    angle = angle * rot_strength;
    let cs = cos(angle);
    let si = sin(angle);
    return mat2x2<f32>(vec2<f32>(cs, si), vec2<f32>(-si, cs));
}

fn gain3(x: vec3<f32>, r: f32) -> vec3<f32> {
    let k = log(1.0 - r) / log(0.5);
    let s = 2.0 * step(vec3<f32>(0.5), x);
    let m = 2.0 * (vec3<f32>(1.0) - s);
    let res = 0.5 * s + 0.25 * m * pow(max(vec3<f32>(0.0), s + x * m), vec3<f32>(k));
    return res / max(res.x + res.y + res.z, 0.0001);
}

// Port of mmikk `TriangleGrid`. `st` is the continuous tile-space coordinate;
// the simplex cell is found via the grid's own floor/frac, so it tiles
// seamlessly — never pre-wrap `st` with fract(), that reintroduces hard seams.
fn triangle_grid(st: vec2<f32>) -> HexTriangleGrid {
    let skewed = HEX_GRID_TO_SKEW * (st * HEX_GRID_SCALE);
    let base_id = vec2<i32>(i32(floor(skewed.x)), i32(floor(skewed.y)));
    let temp = fract(skewed);
    let temp_z = 1.0 - temp.x - temp.y;

    let s = step(0.0, -temp_z);
    let s2 = 2.0 * s - 1.0;
    let s_i = i32(s);

    var grid: HexTriangleGrid;
    grid.w1 = -temp_z * s2;
    grid.w2 = s - temp.y * s2;
    grid.w3 = s - temp.x * s2;
    grid.vertex1 = base_id + vec2<i32>(s_i, s_i);
    grid.vertex2 = base_id + vec2<i32>(s_i, 1 - s_i);
    grid.vertex3 = base_id + vec2<i32>(1 - s_i, s_i);
    return grid;
}

fn hex_color_sample(
    tex: texture_2d<f32>,
    samp: sampler,
    st: vec2<f32>,
    rot_strength: f32,
    border_contrast: f32,
) -> vec4<f32> {
    let dst_dx = dpdx(st);
    let dst_dy = dpdy(st);
    let grid = triangle_grid(st);

    let rot1 = load_rotation_2x2(grid.vertex1, rot_strength);
    let rot2 = load_rotation_2x2(grid.vertex2, rot_strength);
    let rot3 = load_rotation_2x2(grid.vertex3, rot_strength);

    let cen1 = make_center_st(grid.vertex1);
    let cen2 = make_center_st(grid.vertex2);
    let cen3 = make_center_st(grid.vertex3);

    let st1 = rot1 * (st - cen1) + cen1
        + hash_2d(vec2<f32>(f32(grid.vertex1.x), f32(grid.vertex1.y)));
    let st2 = rot2 * (st - cen2) + cen2
        + hash_2d(vec2<f32>(f32(grid.vertex2.x), f32(grid.vertex2.y)));
    let st3 = rot3 * (st - cen3) + cen3
        + hash_2d(vec2<f32>(f32(grid.vertex3.x), f32(grid.vertex3.y)));

    let c1 = textureSampleGrad(tex, samp, st1, rot1 * dst_dx, rot1 * dst_dy);
    let c2 = textureSampleGrad(tex, samp, st2, rot2 * dst_dx, rot2 * dst_dy);
    let c3 = textureSampleGrad(tex, samp, st3, rot3 * dst_dx, rot3 * dst_dy);

    var dw = vec3<f32>(
        dot(c1.xyz, HEX_LUM_WEIGHT),
        dot(c2.xyz, HEX_LUM_WEIGHT),
        dot(c3.xyz, HEX_LUM_WEIGHT),
    );
    dw = mix(vec3<f32>(1.0), dw, HEX_FALLOFF_CONTRAST);
    var weights = dw * pow(vec3<f32>(grid.w1, grid.w2, grid.w3), vec3<f32>(HEX_WEIGHT_EXP));
    weights = weights / max(weights.x + weights.y + weights.z, 0.0001);
    if (border_contrast != 0.5) {
        weights = gain3(weights, border_contrast);
    }

    return c1 * weights.x + c2 * weights.y + c3 * weights.z;
}

// Tile-space coordinate for a triplanar plane: world units scaled by the
// terrain texture scale, used continuously (no fract — see triangle_grid).
fn hex_planar_coords(world_coord: vec2<f32>, tex_scale: f32) -> vec2<f32> {
    return world_coord / tex_scale;
}

fn sample_normal_derivative_grad(
    tex: texture_2d<f32>,
    samp: sampler,
    st: vec2<f32>,
    dst_dx: vec2<f32>,
    dst_dy: vec2<f32>,
) -> vec2<f32> {
    let n = textureSampleGrad(tex, samp, st, dst_dx, dst_dy).rgb;
    return tspace_normal_to_derivative(n * 2.0 - 1.0);
}

// Port of mmikk `bumphex2derivNMap` — blends normal-map derivatives per hex cell.
fn hex_normal_derivative(
    tex: texture_2d<f32>,
    samp: sampler,
    st: vec2<f32>,
    rot_strength: f32,
    border_contrast: f32,
) -> vec2<f32> {
    let dst_dx = dpdx(st);
    let dst_dy = dpdy(st);
    let grid = triangle_grid(st);

    let rot1 = load_rotation_2x2(grid.vertex1, rot_strength);
    let rot2 = load_rotation_2x2(grid.vertex2, rot_strength);
    let rot3 = load_rotation_2x2(grid.vertex3, rot_strength);

    let cen1 = make_center_st(grid.vertex1);
    let cen2 = make_center_st(grid.vertex2);
    let cen3 = make_center_st(grid.vertex3);

    let st1 = rot1 * (st - cen1) + cen1
        + hash_2d(vec2<f32>(f32(grid.vertex1.x), f32(grid.vertex1.y)));
    let st2 = rot2 * (st - cen2) + cen2
        + hash_2d(vec2<f32>(f32(grid.vertex2.x), f32(grid.vertex2.y)));
    let st3 = rot3 * (st - cen3) + cen3
        + hash_2d(vec2<f32>(f32(grid.vertex3.x), f32(grid.vertex3.y)));

    var d1 = rot1 * sample_normal_derivative_grad(tex, samp, st1, rot1 * dst_dx, rot1 * dst_dy);
    var d2 = rot2 * sample_normal_derivative_grad(tex, samp, st2, rot2 * dst_dx, rot2 * dst_dy);
    var d3 = rot3 * sample_normal_derivative_grad(tex, samp, st3, rot3 * dst_dx, rot3 * dst_dy);

    let deriv_mag = vec3<f32>(dot(d1, d1), dot(d2, d2), dot(d3, d3));
    var dw = sqrt(deriv_mag / (vec3<f32>(1.0) + deriv_mag));
    dw = mix(vec3<f32>(1.0), dw, HEX_FALLOFF_CONTRAST);
    var weights = dw * pow(vec3<f32>(grid.w1, grid.w2, grid.w3), vec3<f32>(HEX_WEIGHT_EXP));
    weights = weights / max(weights.x + weights.y + weights.z, 0.0001);
    if (border_contrast != 0.5) {
        weights = gain3(weights, border_contrast);
    }

    return d1 * weights.x + d2 * weights.y + d3 * weights.z;
}
