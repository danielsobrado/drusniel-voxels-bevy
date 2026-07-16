use serde::Serialize;

use super::edge_metrics::sobel_magnitudes;
use super::image_linear::{LinearImage, rec709_luminance};
use super::schema::{NumericRange, RegionProbe};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RegionProbeMetrics {
    pub luminance_mean: f64,
    pub luminance_stddev: f64,
    pub luminance_min: f64,
    pub luminance_max: f64,
    pub luminance_p05: f64,
    pub luminance_p50: f64,
    pub luminance_p95: f64,
    pub chroma_mean: f64,
    pub black_pixel_fraction: f64,
    pub clipped_pixel_fraction: f64,
    pub mean_rgb: [f64; 3],
    pub edge_magnitude: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RegionProbeResult {
    pub id: String,
    pub status: RegionStatus,
    pub metrics: RegionProbeMetrics,
    pub failures: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RegionStatus {
    Pass,
    Fail,
}

impl RegionStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
        }
    }
}

pub fn evaluate_region_probe(image: &LinearImage, probe: &RegionProbe) -> RegionProbeResult {
    let [normalized_x, normalized_y, normalized_width, normalized_height] = probe.rect_normalized;
    let x0 = (normalized_x * f64::from(image.width)).floor() as u32;
    let y0 = (normalized_y * f64::from(image.height)).floor() as u32;
    let x1 = ((normalized_x + normalized_width) * f64::from(image.width))
        .ceil()
        .max(f64::from(x0 + 1)) as u32;
    let y1 = ((normalized_y + normalized_height) * f64::from(image.height))
        .ceil()
        .max(f64::from(y0 + 1)) as u32;
    let x1 = x1.min(image.width);
    let y1 = y1.min(image.height);
    let edges = sobel_magnitudes(image);

    let mut luminance = Vec::new();
    let mut sum_rgb = [0.0_f64; 3];
    let mut chroma_sum = 0.0;
    let mut black_count = 0_u64;
    let mut clipped_count = 0_u64;
    let mut edge_sum = 0.0;

    for y in y0..y1 {
        for x in x0..x1 {
            let pixel = y as usize * image.width as usize + x as usize;
            let offset = pixel * 3;
            let rgb = [
                image.rgb[offset],
                image.rgb[offset + 1],
                image.rgb[offset + 2],
            ];
            let value = rec709_luminance(rgb[0], rgb[1], rgb[2]);
            luminance.push(f64::from(value));
            for channel in 0..3 {
                sum_rgb[channel] += f64::from(rgb[channel]);
            }
            chroma_sum += f64::from(
                rgb.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                    - rgb.iter().copied().fold(f32::INFINITY, f32::min),
            );
            if value < 0.01 {
                black_count += 1;
            }
            if rgb.iter().any(|channel| *channel > 0.99) {
                clipped_count += 1;
            }
            edge_sum += f64::from(edges[pixel]);
        }
    }

    luminance.sort_by(|left, right| left.total_cmp(right));
    let count = luminance.len().max(1);
    let luminance_mean = luminance.iter().sum::<f64>() / count as f64;
    let luminance_stddev = (luminance
        .iter()
        .map(|value| {
            let delta = value - luminance_mean;
            delta * delta
        })
        .sum::<f64>()
        / count as f64)
        .sqrt();
    let metrics = RegionProbeMetrics {
        luminance_mean,
        luminance_stddev,
        luminance_min: luminance.first().copied().unwrap_or(0.0),
        luminance_max: luminance.last().copied().unwrap_or(0.0),
        luminance_p05: percentile(&luminance, 0.05),
        luminance_p50: percentile(&luminance, 0.50),
        luminance_p95: percentile(&luminance, 0.95),
        chroma_mean: chroma_sum / count as f64,
        black_pixel_fraction: black_count as f64 / count as f64,
        clipped_pixel_fraction: clipped_count as f64 / count as f64,
        mean_rgb: [
            sum_rgb[0] / count as f64,
            sum_rgb[1] / count as f64,
            sum_rgb[2] / count as f64,
        ],
        edge_magnitude: edge_sum / count as f64,
    };

    let mut failures = Vec::new();
    for (metric, range) in &probe.gates {
        let observed = match metric.as_str() {
            "luminance_mean" => metrics.luminance_mean,
            "luminance_stddev" => metrics.luminance_stddev,
            "chroma_mean" => metrics.chroma_mean,
            "black_pixel_fraction" => metrics.black_pixel_fraction,
            "clipped_pixel_fraction" => metrics.clipped_pixel_fraction,
            "edge_magnitude" => metrics.edge_magnitude,
            _ => continue,
        };
        evaluate_range(metric, observed, range, &mut failures);
    }

    RegionProbeResult {
        id: probe.id.clone(),
        status: if failures.is_empty() {
            RegionStatus::Pass
        } else {
            RegionStatus::Fail
        },
        metrics,
        failures,
    }
}

fn percentile(sorted: &[f64], quantile: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * quantile).floor() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn evaluate_range(
    metric: &str,
    observed: f64,
    range: &NumericRange,
    failures: &mut Vec<String>,
) {
    if let Some(minimum) = range.min
        && observed < minimum
    {
        failures.push(format!("{metric} {observed} < {minimum}"));
    }
    if let Some(maximum) = range.max
        && observed > maximum
    {
        failures.push(format!("{metric} {observed} > {maximum}"));
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[test]
    fn evaluates_signal_and_variance_boundaries() {
        let image = LinearImage {
            width: 2,
            height: 1,
            rgb: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
        };
        let probe = RegionProbe {
            id: "signal".into(),
            rect_normalized: [0.0, 0.0, 1.0, 1.0],
            gates: BTreeMap::from([
                (
                    "luminance_mean".into(),
                    NumericRange {
                        min: Some(0.49),
                        max: Some(0.51),
                    },
                ),
                (
                    "luminance_stddev".into(),
                    NumericRange {
                        min: Some(0.49),
                        max: None,
                    },
                ),
            ]),
        };
        let result = evaluate_region_probe(&image, &probe);
        assert_eq!(result.status, RegionStatus::Pass);
    }
}
