use super::config::{NoiseBakeConfig, NoiseBakePeriods};

#[derive(Clone, Debug, PartialEq)]
pub struct NoiseBake {
    pub resolution: u32,
    pub periods: NoiseBakePeriods,
    pub data_a: Vec<u8>,
    pub data_b: Vec<u8>,
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn hash2(ix: i32, iy: i32, seed: u32) -> f32 {
    let mut h = (ix as u32).wrapping_mul(374_761_393)
        ^ (iy as u32).wrapping_mul(668_265_263)
        ^ seed.wrapping_mul(2_246_822_519);
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    h as f32 / u32::MAX as f32
}

fn hash22(ix: i32, iy: i32, seed: u32) -> [f32; 2] {
    [
        hash2(ix, iy, seed),
        hash2(ix + 19, iy - 37, seed ^ 0x9e37_79b9),
    ]
}

fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

pub fn value_noise_2d(x: f32, y: f32, seed: u32) -> f32 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let ux = smooth(fx);
    let uy = smooth(fy);
    let a = hash2(ix, iy, seed);
    let b = hash2(ix + 1, iy, seed);
    let c = hash2(ix, iy + 1, seed);
    let d = hash2(ix + 1, iy + 1, seed);
    let x0 = a + (b - a) * ux;
    let x1 = c + (d - c) * ux;
    x0 + (x1 - x0) * uy
}

pub fn fbm_2d(x: f32, y: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for octave in 0..octaves {
        sum += value_noise_2d(
            x * freq + octave as f32 * 17.13,
            y * freq - octave as f32 * 9.71,
            seed + octave * 1013,
        ) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.02;
    }
    sum / norm.max(0.0001)
}

pub fn ridged_2d(x: f32, y: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for octave in 0..octaves {
        let n = (value_noise_2d(
            x * freq + octave as f32 * 13.7,
            y * freq + octave as f32 * 5.2,
            seed ^ 0x6c8e_9cf5,
        ) * 2.0
            - 1.0)
            .abs();
        let r = 1.0 - n;
        sum += r * r * amp;
        norm += amp;
        amp *= 0.53;
        freq *= 2.1;
    }
    sum / norm.max(0.0001)
}

pub fn worley_f1(x: f32, y: f32, seed: u32) -> f32 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let mut best: f32 = 8.0;
    for oy in -1..=1 {
        for ox in -1..=1 {
            let [hx, hy] = hash22(ix + ox, iy + oy, seed);
            let dx = ox as f32 + hx - fx;
            let dy = oy as f32 + hy - fy;
            best = best.min((dx * dx + dy * dy).sqrt());
        }
    }
    clamp01(best / std::f32::consts::SQRT_2)
}

fn enc01(value: f32) -> u8 {
    (clamp01(value) * 255.0).round() as u8
}

fn enc_signed(value: f32, range: f32) -> u8 {
    enc01(value / (range * 2.0) + 0.5)
}

pub fn bake_noise_textures(config: &NoiseBakeConfig, seed: u32) -> NoiseBake {
    let resolution = config.resolution.max(2);
    let mut data_a = vec![0u8; (resolution * resolution * 4) as usize];
    let mut data_b = vec![0u8; (resolution * resolution * 4) as usize];
    let e_fbm = (config.periods.fbm / resolution as f32) * 0.5;
    let e_rid = (config.periods.ridged / resolution as f32) * 0.5;
    let grad_range = 2.0;

    for y in 0..resolution {
        for x in 0..resolution {
            let i = ((y * resolution + x) * 4) as usize;
            let u = (x as f32 + 0.5) / resolution as f32;
            let v = (y as f32 + 0.5) / resolution as f32;
            let value = value_noise_2d(u * config.periods.value, v * config.periods.value, seed);
            let fx = u * config.periods.fbm;
            let fy = v * config.periods.fbm;
            let fbm = fbm_2d(fx, fy, seed, 3);
            let fdx =
                (fbm_2d(fx + e_fbm, fy, seed, 3) - fbm_2d(fx - e_fbm, fy, seed, 3)) / (2.0 * e_fbm);
            let fdy =
                (fbm_2d(fx, fy + e_fbm, seed, 3) - fbm_2d(fx, fy - e_fbm, seed, 3)) / (2.0 * e_fbm);
            let rx = u * config.periods.ridged;
            let ry = v * config.periods.ridged;
            let ridged = ridged_2d(rx, ry, seed, 3);
            let rdx = (ridged_2d(rx + e_rid, ry, seed, 3) - ridged_2d(rx - e_rid, ry, seed, 3))
                / (2.0 * e_rid);
            let rdy = (ridged_2d(rx, ry + e_rid, seed, 3) - ridged_2d(rx, ry - e_rid, seed, 3))
                / (2.0 * e_rid);
            let worley = worley_f1(u * config.periods.worley, v * config.periods.worley, seed);

            data_a[i] = enc01(value);
            data_a[i + 1] = enc01(fbm);
            data_a[i + 2] = enc_signed(fdx, grad_range);
            data_a[i + 3] = enc_signed(fdy, grad_range);
            data_b[i] = enc_signed(rdx, grad_range);
            data_b[i + 1] = enc_signed(rdy, grad_range);
            data_b[i + 2] = enc01(ridged);
            data_b[i + 3] = enc01(worley);
        }
    }

    NoiseBake {
        resolution,
        periods: config.periods,
        data_a,
        data_b,
    }
}

pub fn sample_noise_channel(data: &[u8], resolution: u32, u: f32, v: f32, channel: usize) -> f32 {
    let x = ((u * resolution as f32).floor() as i32).rem_euclid(resolution as i32) as u32;
    let y = ((v * resolution as f32).floor() as i32).rem_euclid(resolution as i32) as u32;
    data[((y * resolution + x) * 4) as usize + channel] as f32 / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bakes_deterministic_noise_for_same_seed() {
        let config = NoiseBakeConfig {
            resolution: 8,
            periods: NoiseBakePeriods {
                value: 6.0,
                fbm: 5.0,
                ridged: 4.0,
                worley: 7.0,
            },
        };

        let first = bake_noise_textures(&config, 42);
        let second = bake_noise_textures(&config, 42);
        let changed = bake_noise_textures(&config, 43);

        assert_eq!(first.data_a, second.data_a);
        assert_eq!(first.data_b, second.data_b);
        assert_ne!(first.data_a, changed.data_a);
    }
}
