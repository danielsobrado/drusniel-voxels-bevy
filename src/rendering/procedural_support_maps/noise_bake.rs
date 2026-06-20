use super::config::{NoiseBakeConfig, NoiseBakePeriods};
use super::seed_streams::derive_seed_streams;

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

fn wrap_lattice(value: i32, period: i32) -> i32 {
    value.rem_euclid(period.max(1))
}

fn period_cells(period: f32) -> i32 {
    period.round().max(1.0) as i32
}

pub fn periodic_value_noise_2d(x: f32, y: f32, period: i32, seed: u32) -> f32 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let ux = smooth(fx);
    let uy = smooth(fy);
    let x0i = wrap_lattice(ix, period);
    let x1i = wrap_lattice(ix + 1, period);
    let y0i = wrap_lattice(iy, period);
    let y1i = wrap_lattice(iy + 1, period);
    let a = hash2(x0i, y0i, seed);
    let b = hash2(x1i, y0i, seed);
    let c = hash2(x0i, y1i, seed);
    let d = hash2(x1i, y1i, seed);
    let x0 = a + (b - a) * ux;
    let x1 = c + (d - c) * ux;
    x0 + (x1 - x0) * uy
}

pub fn periodic_fbm_2d(x: f32, y: f32, period: i32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for octave in 0..octaves {
        let octave_period = period.saturating_mul(freq).max(1);
        sum += periodic_value_noise_2d(
            x * freq as f32 + octave as f32 * 17.0,
            y * freq as f32 - octave as f32 * 9.0,
            octave_period,
            seed + octave * 1013,
        ) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    sum / norm.max(0.0001)
}

pub fn periodic_ridged_2d(x: f32, y: f32, period: i32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for octave in 0..octaves {
        let octave_period = period.saturating_mul(freq).max(1);
        let n = (periodic_value_noise_2d(
            x * freq as f32 + octave as f32 * 13.0,
            y * freq as f32 + octave as f32 * 5.0,
            octave_period,
            seed ^ 0x6c8e_9cf5,
        ) * 2.0
            - 1.0)
            .abs();
        let r = 1.0 - n;
        sum += r * r * amp;
        norm += amp;
        amp *= 0.53;
        freq *= 2;
    }
    sum / norm.max(0.0001)
}

pub fn periodic_worley_f1(x: f32, y: f32, period: i32, seed: u32) -> f32 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let mut best: f32 = 8.0;
    for oy in -1..=1 {
        for ox in -1..=1 {
            let [hx, hy] = hash22(
                wrap_lattice(ix + ox, period),
                wrap_lattice(iy + oy, period),
                seed,
            );
            let dx = ox as f32 + hx - fx;
            let dy = oy as f32 + hy - fy;
            best = best.min((dx * dx + dy * dy).sqrt());
        }
    }
    clamp01(best / std::f32::consts::SQRT_2)
}

pub fn periodic_worley_f1_edge(
    x: f32,
    y: f32,
    period_x: f32,
    period_y: f32,
    seed: u32,
) -> [f32; 2] {
    let px = period_cells(period_x);
    let py = period_cells(period_y);
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let mut best = f32::INFINITY;
    let mut second = f32::INFINITY;
    for oy in -1..=1 {
        for ox in -1..=1 {
            let [hx, hy] = hash22(wrap_lattice(ix + ox, px), wrap_lattice(iy + oy, py), seed);
            let dx = ox as f32 + hx - fx;
            let dy = oy as f32 + hy - fy;
            let d = (dx * dx + dy * dy).sqrt();
            if d < best {
                second = best;
                best = d;
            } else if d < second && d > best + 0.00001 {
                second = d;
            }
        }
    }
    [
        clamp01(best / std::f32::consts::SQRT_2),
        clamp01((second - best) / std::f32::consts::SQRT_2),
    ]
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
    let value_period = period_cells(config.periods.value);
    let fbm_period = period_cells(config.periods.fbm);
    let ridged_period = period_cells(config.periods.ridged);
    let worley_period = period_cells(config.periods.worley);
    let streams = derive_seed_streams(seed);
    let grad_range = 2.0;

    for y in 0..resolution {
        for x in 0..resolution {
            let i = ((y * resolution + x) * 4) as usize;
            let u = (x as f32 + 0.5) / resolution as f32;
            let v = (y as f32 + 0.5) / resolution as f32;
            let value = periodic_value_noise_2d(
                u * config.periods.value,
                v * config.periods.value,
                value_period,
                streams.noise_value,
            );
            let fx = u * config.periods.fbm;
            let fy = v * config.periods.fbm;
            let fbm = periodic_fbm_2d(fx, fy, fbm_period, streams.noise_fbm, 3);
            let fdx = (periodic_fbm_2d(fx + e_fbm, fy, fbm_period, streams.noise_fbm, 3)
                - periodic_fbm_2d(fx - e_fbm, fy, fbm_period, streams.noise_fbm, 3))
                / (2.0 * e_fbm);
            let fdy = (periodic_fbm_2d(fx, fy + e_fbm, fbm_period, streams.noise_fbm, 3)
                - periodic_fbm_2d(fx, fy - e_fbm, fbm_period, streams.noise_fbm, 3))
                / (2.0 * e_fbm);
            let rx = u * config.periods.ridged;
            let ry = v * config.periods.ridged;
            let ridged = periodic_ridged_2d(rx, ry, ridged_period, streams.noise_ridged, 3);
            let rdx = (periodic_ridged_2d(rx + e_rid, ry, ridged_period, streams.noise_ridged, 3)
                - periodic_ridged_2d(rx - e_rid, ry, ridged_period, streams.noise_ridged, 3))
                / (2.0 * e_rid);
            let rdy = (periodic_ridged_2d(rx, ry + e_rid, ridged_period, streams.noise_ridged, 3)
                - periodic_ridged_2d(rx, ry - e_rid, ridged_period, streams.noise_ridged, 3))
                / (2.0 * e_rid);
            let worley = periodic_worley_f1(
                u * config.periods.worley,
                v * config.periods.worley,
                worley_period,
                streams.noise_worley,
            );

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

    #[test]
    fn procedural_noise_functions_are_periodic() {
        let seed = 42;
        let period = 8;
        let x = 3.375;
        let y = 5.125;
        let eps = 0.00001;

        assert!(
            (periodic_value_noise_2d(x, y, period, seed)
                - periodic_value_noise_2d(x + period as f32, y, period, seed))
            .abs()
                < eps
        );
        assert!(
            (periodic_fbm_2d(x, y, period, seed, 3)
                - periodic_fbm_2d(x, y + period as f32, period, seed, 3))
            .abs()
                < eps
        );
        assert!(
            (periodic_ridged_2d(x, y, period, seed, 3)
                - periodic_ridged_2d(x + period as f32, y + period as f32, period, seed, 3))
            .abs()
                < eps
        );
        assert!(
            (periodic_worley_f1(x, y, period, seed)
                - periodic_worley_f1(x + period as f32, y, period, seed))
            .abs()
                < eps
        );
        assert!(
            (periodic_worley_f1_edge(x, y, 9.0, 5.0, seed)[0]
                - periodic_worley_f1_edge(x + 9.0, y, 9.0, 5.0, seed)[0])
                .abs()
                < eps
        );
        assert!(
            (periodic_worley_f1_edge(x, y, 9.0, 5.0, seed)[1]
                - periodic_worley_f1_edge(x, y + 5.0, 9.0, 5.0, seed)[1])
                .abs()
                < eps
        );
    }

    #[test]
    fn packed_gradient_channels_match_across_periodic_domain() {
        let config = NoiseBakeConfig {
            resolution: 16,
            periods: NoiseBakePeriods {
                value: 8.0,
                fbm: 8.0,
                ridged: 8.0,
                worley: 8.0,
            },
        };
        let bake = bake_noise_textures(&config, 9);
        let u = 0.28125;
        let v = 0.65625;

        for channel in [2, 3] {
            assert_eq!(
                sample_noise_channel(&bake.data_a, bake.resolution, u, v, channel),
                sample_noise_channel(&bake.data_a, bake.resolution, u + 1.0, v, channel)
            );
        }
        for channel in [0, 1] {
            assert_eq!(
                sample_noise_channel(&bake.data_b, bake.resolution, u, v, channel),
                sample_noise_channel(&bake.data_b, bake.resolution, u, v + 1.0, channel)
            );
        }
    }
}
