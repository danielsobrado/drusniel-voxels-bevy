use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

use image::{ImageBuffer, Luma, Rgb};
use serde::Serialize;
use thiserror::Error;

use super::edge_metrics::sobel_magnitudes;
use super::image_linear::{LinearImage, linear_to_srgb8, rec709_luminance};

const THRESHOLD_EPSILON: f64 = 1e-7;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ImageMetrics {
    pub mean_absolute_error: f64,
    pub p50_absolute_error: f64,
    pub p95_absolute_error: f64,
    pub p99_absolute_error: f64,
    pub changed_pixel_fraction: f64,
    pub luminance_mean_baseline: f64,
    pub luminance_mean_actual: f64,
    pub luminance_stddev_baseline: f64,
    pub luminance_stddev_actual: f64,
    pub chroma_mean_baseline: f64,
    pub chroma_mean_actual: f64,
    pub chroma_stddev_baseline: f64,
    pub chroma_stddev_actual: f64,
    pub edge_magnitude_mean_baseline: f64,
    pub edge_magnitude_mean_actual: f64,
    pub edge_error_mean: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ImageComparison {
    pub unmasked: ImageMetrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masked: Option<ImageMetrics>,
    #[serde(skip)]
    pub pixel_errors: Vec<f32>,
    #[serde(skip)]
    pub changed_mask: Vec<u8>,
}

impl ImageComparison {
    pub fn gated_metrics(&self) -> &ImageMetrics {
        self.masked.as_ref().unwrap_or(&self.unmasked)
    }
}

#[derive(Debug, Error)]
pub enum ImageMetricsError {
    #[error("image dimensions differ: baseline {baseline:?}, actual {actual:?}")]
    DimensionMismatch {
        baseline: (u32, u32),
        actual: (u32, u32),
    },
    #[error("mask weight count {actual} does not match image pixel count {expected}")]
    MaskLengthMismatch { actual: usize, expected: usize },
    #[error("image mask excludes every pixel")]
    EmptyMask,
    #[error("failed to create artifact directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to write image artifact {path}: {source}")]
    Write {
        path: PathBuf,
        source: image::ImageError,
    },
}

pub struct ImageArtifactPaths<'a> {
    pub diff: &'a Path,
    pub heatmap: &'a Path,
    pub changed_mask: &'a Path,
}

pub fn compare_images(
    baseline: &LinearImage,
    actual: &LinearImage,
    changed_pixel_threshold: f64,
    weights: Option<&[f32]>,
) -> Result<ImageComparison, ImageMetricsError> {
    assert_same_dimensions(baseline, actual)?;
    let pixel_count = baseline.width as usize * baseline.height as usize;
    if let Some(weights) = weights
        && weights.len() != pixel_count
    {
        return Err(ImageMetricsError::MaskLengthMismatch {
            actual: weights.len(),
            expected: pixel_count,
        });
    }

    let mut pixel_errors = vec![0.0_f32; pixel_count];
    let mut changed_mask = vec![0_u8; pixel_count];
    let mut luminance_baseline = vec![0.0_f32; pixel_count];
    let mut luminance_actual = vec![0.0_f32; pixel_count];
    let mut chroma_baseline = vec![0.0_f32; pixel_count];
    let mut chroma_actual = vec![0.0_f32; pixel_count];

    for pixel in 0..pixel_count {
        let offset = pixel * 3;
        let baseline_rgb = [
            baseline.rgb[offset],
            baseline.rgb[offset + 1],
            baseline.rgb[offset + 2],
        ];
        let actual_rgb = [
            actual.rgb[offset],
            actual.rgb[offset + 1],
            actual.rgb[offset + 2],
        ];
        let error = baseline_rgb
            .iter()
            .zip(actual_rgb.iter())
            .map(|(baseline, actual)| (baseline - actual).abs())
            .sum::<f32>()
            / 3.0;
        pixel_errors[pixel] = error;
        if f64::from(error) > changed_pixel_threshold + THRESHOLD_EPSILON {
            changed_mask[pixel] = 255;
        }
        luminance_baseline[pixel] = rec709_luminance(
            baseline_rgb[0],
            baseline_rgb[1],
            baseline_rgb[2],
        );
        luminance_actual[pixel] = rec709_luminance(actual_rgb[0], actual_rgb[1], actual_rgb[2]);
        chroma_baseline[pixel] = chroma(baseline_rgb);
        chroma_actual[pixel] = chroma(actual_rgb);
    }

    let baseline_edges = sobel_magnitudes(baseline);
    let actual_edges = sobel_magnitudes(actual);
    let unmasked = compute_metrics(
        &pixel_errors,
        &luminance_baseline,
        &luminance_actual,
        &chroma_baseline,
        &chroma_actual,
        &baseline_edges,
        &actual_edges,
        changed_pixel_threshold,
        None,
    )?;
    let masked = weights
        .map(|weights| {
            compute_metrics(
                &pixel_errors,
                &luminance_baseline,
                &luminance_actual,
                &chroma_baseline,
                &chroma_actual,
                &baseline_edges,
                &actual_edges,
                changed_pixel_threshold,
                Some(weights),
            )
        })
        .transpose()?;

    if let Some(weights) = weights {
        for (mask, weight) in changed_mask.iter_mut().zip(weights.iter().copied()) {
            if weight <= 0.0 {
                *mask = 0;
            }
        }
    }

    Ok(ImageComparison {
        unmasked,
        masked,
        pixel_errors,
        changed_mask,
    })
}

pub fn write_image_artifacts(
    baseline: &LinearImage,
    actual: &LinearImage,
    comparison: &ImageComparison,
    paths: &ImageArtifactPaths<'_>,
) -> Result<(), ImageMetricsError> {
    if let Some(parent) = paths.diff.parent() {
        fs::create_dir_all(parent).map_err(|source| ImageMetricsError::CreateDir {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let mut side_by_side = ImageBuffer::<Rgb<u8>, Vec<u8>>::new(
        baseline.width.saturating_mul(2),
        baseline.height,
    );
    for y in 0..baseline.height {
        for x in 0..baseline.width {
            let pixel = (y as usize * baseline.width as usize + x as usize) * 3;
            side_by_side.put_pixel(
                x,
                y,
                Rgb([
                    linear_to_srgb8(baseline.rgb[pixel]),
                    linear_to_srgb8(baseline.rgb[pixel + 1]),
                    linear_to_srgb8(baseline.rgb[pixel + 2]),
                ]),
            );
            side_by_side.put_pixel(
                x + baseline.width,
                y,
                Rgb([
                    linear_to_srgb8(actual.rgb[pixel]),
                    linear_to_srgb8(actual.rgb[pixel + 1]),
                    linear_to_srgb8(actual.rgb[pixel + 2]),
                ]),
            );
        }
    }
    side_by_side
        .save(paths.diff)
        .map_err(|source| ImageMetricsError::Write {
            path: paths.diff.to_path_buf(),
            source,
        })?;

    let mut heatmap = ImageBuffer::<Luma<u8>, Vec<u8>>::new(baseline.width, baseline.height);
    let mut changed = ImageBuffer::<Luma<u8>, Vec<u8>>::new(baseline.width, baseline.height);
    for y in 0..baseline.height {
        for x in 0..baseline.width {
            let pixel = y as usize * baseline.width as usize + x as usize;
            heatmap.put_pixel(
                x,
                y,
                Luma([(comparison.pixel_errors[pixel].clamp(0.0, 1.0) * 255.0).round() as u8]),
            );
            changed.put_pixel(x, y, Luma([comparison.changed_mask[pixel]]));
        }
    }
    heatmap
        .save(paths.heatmap)
        .map_err(|source| ImageMetricsError::Write {
            path: paths.heatmap.to_path_buf(),
            source,
        })?;
    changed
        .save(paths.changed_mask)
        .map_err(|source| ImageMetricsError::Write {
            path: paths.changed_mask.to_path_buf(),
            source,
        })?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn compute_metrics(
    errors: &[f32],
    luminance_baseline: &[f32],
    luminance_actual: &[f32],
    chroma_baseline: &[f32],
    chroma_actual: &[f32],
    baseline_edges: &[f32],
    actual_edges: &[f32],
    changed_pixel_threshold: f64,
    weights: Option<&[f32]>,
) -> Result<ImageMetrics, ImageMetricsError> {
    let weight_sum = total_weight(errors.len(), weights);
    if weight_sum <= 0.0 {
        return Err(ImageMetricsError::EmptyMask);
    }
    let changed_weight = errors
        .iter()
        .enumerate()
        .filter(|(_, error)| {
            f64::from(**error) > changed_pixel_threshold + THRESHOLD_EPSILON
        })
        .map(|(index, _)| f64::from(weights.map_or(1.0, |weights| weights[index]).max(0.0)))
        .sum::<f64>();

    Ok(ImageMetrics {
        mean_absolute_error: weighted_mean(errors, weights),
        p50_absolute_error: weighted_percentile(errors, weights, 0.50),
        p95_absolute_error: weighted_percentile(errors, weights, 0.95),
        p99_absolute_error: weighted_percentile(errors, weights, 0.99),
        changed_pixel_fraction: changed_weight / weight_sum,
        luminance_mean_baseline: weighted_mean(luminance_baseline, weights),
        luminance_mean_actual: weighted_mean(luminance_actual, weights),
        luminance_stddev_baseline: weighted_stddev(luminance_baseline, weights),
        luminance_stddev_actual: weighted_stddev(luminance_actual, weights),
        chroma_mean_baseline: weighted_mean(chroma_baseline, weights),
        chroma_mean_actual: weighted_mean(chroma_actual, weights),
        chroma_stddev_baseline: weighted_stddev(chroma_baseline, weights),
        chroma_stddev_actual: weighted_stddev(chroma_actual, weights),
        edge_magnitude_mean_baseline: weighted_mean(baseline_edges, weights),
        edge_magnitude_mean_actual: weighted_mean(actual_edges, weights),
        edge_error_mean: weighted_absolute_difference(baseline_edges, actual_edges, weights),
    })
}

fn assert_same_dimensions(
    baseline: &LinearImage,
    actual: &LinearImage,
) -> Result<(), ImageMetricsError> {
    let baseline_dimensions = (baseline.width, baseline.height);
    let actual_dimensions = (actual.width, actual.height);
    if baseline_dimensions != actual_dimensions {
        return Err(ImageMetricsError::DimensionMismatch {
            baseline: baseline_dimensions,
            actual: actual_dimensions,
        });
    }
    Ok(())
}

fn chroma(rgb: [f32; 3]) -> f32 {
    rgb.iter().copied().fold(f32::NEG_INFINITY, f32::max)
        - rgb.iter().copied().fold(f32::INFINITY, f32::min)
}

fn total_weight(length: usize, weights: Option<&[f32]>) -> f64 {
    (0..length)
        .map(|index| f64::from(weights.map_or(1.0, |weights| weights[index]).max(0.0)))
        .sum()
}

fn weighted_percentile(values: &[f32], weights: Option<&[f32]>, quantile: f64) -> f64 {
    let mut samples = values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let weight = weights.map_or(1.0, |weights| weights[index]);
            (weight > 0.0).then_some((*value, weight))
        })
        .collect::<Vec<_>>();
    samples.sort_by(|left, right| left.0.partial_cmp(&right.0).unwrap_or(Ordering::Equal));
    let target = samples
        .iter()
        .map(|(_, weight)| f64::from(*weight))
        .sum::<f64>()
        * quantile;
    let mut cumulative = 0.0;
    for (value, weight) in &samples {
        cumulative += f64::from(*weight);
        if cumulative >= target {
            return f64::from(*value);
        }
    }
    samples.last().map_or(0.0, |(value, _)| f64::from(*value))
}

fn weighted_mean(values: &[f32], weights: Option<&[f32]>) -> f64 {
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for (index, value) in values.iter().copied().enumerate() {
        let weight = f64::from(weights.map_or(1.0, |weights| weights[index]));
        if weight > 0.0 {
            sum += f64::from(value) * weight;
            weight_sum += weight;
        }
    }
    if weight_sum > 0.0 { sum / weight_sum } else { 0.0 }
}

fn weighted_stddev(values: &[f32], weights: Option<&[f32]>) -> f64 {
    let mean = weighted_mean(values, weights);
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for (index, value) in values.iter().copied().enumerate() {
        let weight = f64::from(weights.map_or(1.0, |weights| weights[index]));
        if weight > 0.0 {
            let delta = f64::from(value) - mean;
            sum += delta * delta * weight;
            weight_sum += weight;
        }
    }
    if weight_sum > 0.0 {
        (sum / weight_sum).sqrt()
    } else {
        0.0
    }
}

fn weighted_absolute_difference(
    left: &[f32],
    right: &[f32],
    weights: Option<&[f32]>,
) -> f64 {
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for index in 0..left.len() {
        let weight = f64::from(weights.map_or(1.0, |weights| weights[index]));
        if weight > 0.0 {
            sum += f64::from((left[index] - right[index]).abs()) * weight;
            weight_sum += weight;
        }
    }
    if weight_sum > 0.0 { sum / weight_sum } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_changed_pixel_and_weighted_mask() {
        let baseline = LinearImage {
            width: 2,
            height: 1,
            rgb: vec![0.0; 6],
        };
        let actual = LinearImage {
            width: 2,
            height: 1,
            rgb: vec![0.0, 0.0, 0.0, 0.3, 0.3, 0.3],
        };
        let result = compare_images(&baseline, &actual, 0.05, Some(&[1.0, 0.0])).unwrap();
        assert!((result.unmasked.changed_pixel_fraction - 0.5).abs() < 1e-6);
        assert_eq!(result.masked.unwrap().changed_pixel_fraction, 0.0);
    }

    #[test]
    fn threshold_is_strictly_greater() {
        let baseline = LinearImage {
            width: 1,
            height: 1,
            rgb: vec![0.0; 3],
        };
        let actual = LinearImage {
            width: 1,
            height: 1,
            rgb: vec![0.05; 3],
        };
        let result = compare_images(&baseline, &actual, 0.05, None).unwrap();
        assert_eq!(result.unmasked.changed_pixel_fraction, 0.0);
    }
}
