// CLOD screen-door dither helper.
//
// Include this from a fragment shader and call `clod_apply_dither_clip()` before
// writing the final terrain color. The role ids intentionally match
// `voxel::pages::dither_material`:
//   0 = stable, 1 = fade-in, 2 = fade-out.

const CLOD_DITHER_ROLE_STABLE: u32 = 0u;
const CLOD_DITHER_ROLE_FADE_IN: u32 = 1u;
const CLOD_DITHER_ROLE_FADE_OUT: u32 = 2u;

const CLOD_BAYER_4X4: array<f32, 16> = array<f32, 16>(
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0,
);

fn clod_dither_threshold(fragment_xy: vec2<f32>) -> f32 {
    let pixel = vec2<u32>(floor(fragment_xy));
    let x = pixel.x & 3u;
    let y = pixel.y & 3u;
    return CLOD_BAYER_4X4[y * 4u + x] / 16.0;
}

fn clod_dither_should_discard(fragment_xy: vec2<f32>, fade_alpha: f32, role: u32) -> bool {
    if (role == CLOD_DITHER_ROLE_STABLE) {
        return false;
    }

    let alpha = clamp(fade_alpha, 0.0, 1.0);
    let threshold = clod_dither_threshold(fragment_xy);

    if (role == CLOD_DITHER_ROLE_FADE_IN) {
        // New pages grow from 0 -> 1 as more Bayer cells pass the mask.
        return threshold >= alpha;
    }

    if (role == CLOD_DITHER_ROLE_FADE_OUT) {
        // Old pages shrink from 1 -> 0 with the complementary mask.
        return threshold < (1.0 - alpha);
    }

    return false;
}

fn clod_apply_dither_clip(fragment_xy: vec2<f32>, fade_alpha: f32, role: u32) {
    if (clod_dither_should_discard(fragment_xy, fade_alpha, role)) {
        discard;
    }
}
