use std::path::{Path, PathBuf};

use image::RgbaImage;
use serde::Serialize;
use thiserror::Error;

use super::config::QaProbeConfig;
use super::constants::{LUMA_B, LUMA_G, LUMA_R};

#[derive(Debug, Error)]
pub enum QaProbeError {
    #[error("probe '{probe_id}' references screenshot '{screenshot_id}', which was not captured")]
    MissingScreenshot {
        probe_id: String,
        screenshot_id: String,
    },
    #[error("failed to read probe image {path}: {source}")]
    Read {
        path: PathBuf,
        source: image::ImageError,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct ProbeResult {
    pub id: String,
    pub probe_type: String,
    pub screenshot: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed: Option<f64>,
    pub expected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

pub fn evaluate_probe(
    probe: &QaProbeConfig,
    screenshot_path: &Path,
) -> Result<ProbeResult, QaProbeError> {
    let image = image::open(screenshot_path)
        .map_err(|source| QaProbeError::Read {
            path: screenshot_path.to_path_buf(),
            source,
        })?
        .to_rgba8();

    Ok(match probe {
        QaProbeConfig::RegionLuminance {
            id,
            screenshot,
            region,
            min,
            max,
        } => {
            let observed = region_luminance(&image, *region);
            ranged_result(id, "region_luminance", screenshot, observed, *min, *max)
        }
        QaProbeConfig::RegionVariance {
            id,
            screenshot,
            region,
            min_luminance_stddev,
        } => {
            let observed = region_luminance_stddev(&image, *region);
            let status = if observed >= *min_luminance_stddev {
                "pass"
            } else {
                "fail"
            };
            ProbeResult {
                id: id.clone(),
                probe_type: "region_variance".to_string(),
                screenshot: screenshot.clone(),
                status: status.to_string(),
                observed: Some(observed),
                expected: format!(">= {min_luminance_stddev:.4}"),
                failure: (status == "fail").then(|| {
                    format!(
                        "luminance stddev {observed:.4} below minimum {min_luminance_stddev:.4}. Likely: a flat region — black frame, flat sky/water, missing geometry, or the screenshot was captured before render-ready."
                    )
                }),
            }
        }
        QaProbeConfig::PixelLuminance {
            id,
            screenshot,
            pixel,
            min,
            max,
        } => {
            let observed = pixel_luminance(&image, *pixel);
            ranged_result(id, "pixel_luminance", screenshot, observed, *min, *max)
        }
    })
}

fn ranged_result(
    id: &str,
    probe_type: &str,
    screenshot: &str,
    observed: f64,
    min: f64,
    max: f64,
) -> ProbeResult {
    let status = if observed >= min && observed <= max {
        "pass"
    } else {
        "fail"
    };
    ProbeResult {
        id: id.to_string(),
        probe_type: probe_type.to_string(),
        screenshot: screenshot.to_string(),
        status: status.to_string(),
        observed: Some(observed),
        expected: format!("{min:.4}..={max:.4}"),
        failure: (status == "fail").then(|| {
            let hint = if observed < min {
                "Likely: region too dark — missing render output, a disabled material, broken exposure, or the screenshot was captured before render-ready."
            } else {
                "Likely: region blown out — overexposure, a bloom/tonemap regression, or wrong checkpoint framing."
            };
            format!(
                "luminance {observed:.4} outside expected range {min:.4}..={max:.4}. {hint}"
            )
        }),
    }
}

fn region_luminance(image: &RgbaImage, region: [f32; 4]) -> f64 {
    let (x0, y0, x1, y1) = pixel_region(image, region);
    let mut sum = 0.0;
    let mut count = 0u64;
    for y in y0..y1 {
        for x in x0..x1 {
            sum += luminance(image.get_pixel(x, y).0);
            count += 1;
        }
    }
    sum / count.max(1) as f64
}

fn region_luminance_stddev(image: &RgbaImage, region: [f32; 4]) -> f64 {
    let (x0, y0, x1, y1) = pixel_region(image, region);
    let mut values = Vec::new();
    for y in y0..y1 {
        for x in x0..x1 {
            values.push(luminance(image.get_pixel(x, y).0));
        }
    }
    let mean = values.iter().sum::<f64>() / values.len().max(1) as f64;
    let variance = values
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f64>()
        / values.len().max(1) as f64;
    variance.sqrt()
}

fn pixel_luminance(image: &RgbaImage, pixel: [f32; 2]) -> f64 {
    let x = (pixel[0] * (image.width().saturating_sub(1)) as f32).round() as u32;
    let y = (pixel[1] * (image.height().saturating_sub(1)) as f32).round() as u32;
    luminance(image.get_pixel(x, y).0)
}

fn pixel_region(image: &RgbaImage, region: [f32; 4]) -> (u32, u32, u32, u32) {
    let width = image.width().max(1);
    let height = image.height().max(1);
    let x0 = (region[0] * width as f32).floor() as u32;
    let y0 = (region[1] * height as f32).floor() as u32;
    let x1 = (region[2] * width as f32).ceil() as u32;
    let y1 = (region[3] * height as f32).ceil() as u32;
    (
        x0.min(width - 1),
        y0.min(height - 1),
        x1.clamp(1, width),
        y1.clamp(1, height),
    )
}

fn luminance(pixel: [u8; 4]) -> f64 {
    (LUMA_R * f64::from(pixel[0]) + LUMA_G * f64::from(pixel[1]) + LUMA_B * f64::from(pixel[2]))
        / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use tempfile::tempdir;

    #[test]
    fn samples_pixel_luminance() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("probe.png");
        let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]));
        image.put_pixel(1, 1, Rgba([255, 255, 255, 255]));
        image.save(&path).unwrap();

        let probe = QaProbeConfig::PixelLuminance {
            id: "white".into(),
            screenshot: "main".into(),
            pixel: [1.0, 1.0],
            min: 0.9,
            max: 1.0,
        };

        let result = evaluate_probe(&probe, &path).unwrap();
        assert_eq!(result.status, "pass");
        assert!((result.observed.unwrap() - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn detects_flat_region_variance() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("probe.png");
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(4, 4, Rgba([128, 128, 128, 255]))
            .save(&path)
            .unwrap();

        let probe = QaProbeConfig::RegionVariance {
            id: "flat".into(),
            screenshot: "main".into(),
            region: [0.0, 0.0, 1.0, 1.0],
            min_luminance_stddev: 0.01,
        };

        let result = evaluate_probe(&probe, &path).unwrap();
        assert_eq!(result.status, "fail");
    }

    #[test]
    fn measures_region_mean_luminance() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("probe.png");
        // Half black, half white -> mean luminance 0.5.
        let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]));
        image.put_pixel(0, 0, Rgba([255, 255, 255, 255]));
        image.put_pixel(1, 1, Rgba([255, 255, 255, 255]));
        image.save(&path).unwrap();

        let probe = QaProbeConfig::RegionLuminance {
            id: "half".into(),
            screenshot: "main".into(),
            region: [0.0, 0.0, 1.0, 1.0],
            min: 0.45,
            max: 0.55,
        };

        let result = evaluate_probe(&probe, &path).unwrap();
        assert_eq!(result.status, "pass");
        assert!((result.observed.unwrap() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn unreadable_image_returns_clean_err() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("missing.png");
        let probe = QaProbeConfig::PixelLuminance {
            id: "px".into(),
            screenshot: "main".into(),
            pixel: [0.5, 0.5],
            min: 0.0,
            max: 1.0,
        };

        assert!(matches!(
            evaluate_probe(&probe, &path),
            Err(QaProbeError::Read { .. })
        ));
    }
}
