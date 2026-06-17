use std::fs;
use std::path::{Path, PathBuf};

use image::{GenericImageView, ImageBuffer, Rgba};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum QaImageError {
    #[error("baseline image is missing: {path}")]
    MissingBaseline { path: PathBuf },
    #[error("failed to read image {path}: {source}")]
    Read {
        path: PathBuf,
        source: image::ImageError,
    },
    #[error("failed to write diff image {path}: {source}")]
    Write {
        path: PathBuf,
        source: image::ImageError,
    },
    #[error("failed to create diff directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("image dimensions differ: actual {actual:?}, expected {expected:?}")]
    DimensionMismatch {
        actual: (u32, u32),
        expected: (u32, u32),
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct ImageDiffMetrics {
    pub changed_ratio: f64,
    pub mean_abs_error: f64,
    pub rmse: f64,
    pub max_channel_delta: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_path: Option<String>,
}

pub fn compare_images(
    actual_path: &Path,
    baseline_path: &Path,
    diff_path: Option<&Path>,
    changed_pixel_threshold: f32,
) -> Result<ImageDiffMetrics, QaImageError> {
    if !baseline_path.exists() {
        return Err(QaImageError::MissingBaseline {
            path: baseline_path.to_path_buf(),
        });
    }

    let actual = image::open(actual_path).map_err(|source| QaImageError::Read {
        path: actual_path.to_path_buf(),
        source,
    })?;
    let expected = image::open(baseline_path).map_err(|source| QaImageError::Read {
        path: baseline_path.to_path_buf(),
        source,
    })?;

    let actual_dims = actual.dimensions();
    let expected_dims = expected.dimensions();
    if actual_dims != expected_dims {
        return Err(QaImageError::DimensionMismatch {
            actual: actual_dims,
            expected: expected_dims,
        });
    }

    let actual = actual.to_rgba8();
    let expected = expected.to_rgba8();
    let threshold = (changed_pixel_threshold.clamp(0.0, 1.0) * 255.0).round() as u8;
    let mut changed = 0u64;
    let mut abs_sum = 0f64;
    let mut squared_sum = 0f64;
    let mut max_channel_delta = 0u8;
    let mut diff_image =
        diff_path.map(|_| ImageBuffer::<Rgba<u8>, Vec<u8>>::new(actual_dims.0, actual_dims.1));

    for (x, y, actual_pixel) in actual.enumerate_pixels() {
        let expected_pixel = expected.get_pixel(x, y);
        let mut max_delta_for_pixel = 0u8;
        let mut diff_channels = [0u8; 4];
        for channel in 0..3 {
            let delta = actual_pixel[channel].abs_diff(expected_pixel[channel]);
            max_delta_for_pixel = max_delta_for_pixel.max(delta);
            max_channel_delta = max_channel_delta.max(delta);
            abs_sum += f64::from(delta);
            squared_sum += f64::from(delta) * f64::from(delta);
            diff_channels[channel] = delta.saturating_mul(4).max(if delta > 0 { 32 } else { 0 });
        }
        diff_channels[3] = 255;
        if max_delta_for_pixel > threshold {
            changed += 1;
        }
        if let Some(image) = diff_image.as_mut() {
            image.put_pixel(x, y, Rgba(diff_channels));
        }
    }

    if let (Some(path), Some(image)) = (diff_path, diff_image) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|source| QaImageError::CreateDir {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        image.save(path).map_err(|source| QaImageError::Write {
            path: path.to_path_buf(),
            source,
        })?;
    }

    let pixels = f64::from(actual_dims.0) * f64::from(actual_dims.1);
    let channels = pixels * 3.0;
    Ok(ImageDiffMetrics {
        changed_ratio: changed as f64 / pixels,
        mean_abs_error: abs_sum / channels,
        rmse: (squared_sum / channels).sqrt(),
        max_channel_delta,
        diff_path: diff_path.map(|path| path.display().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn detects_one_changed_pixel() {
        let dir = tempdir().unwrap();
        let actual = dir.path().join("actual.png");
        let expected = dir.path().join("expected.png");
        let mut actual_image =
            ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]));
        let expected_image =
            ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]));
        actual_image.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        actual_image.save(&actual).unwrap();
        expected_image.save(&expected).unwrap();

        let metrics = compare_images(&actual, &expected, None, 0.08).unwrap();
        assert_eq!(metrics.changed_ratio, 0.25);
        assert_eq!(metrics.max_channel_delta, 255);
    }

    #[test]
    fn identical_images_pass() {
        let dir = tempdir().unwrap();
        let actual = dir.path().join("actual.png");
        let expected = dir.path().join("expected.png");
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(3, 3, Rgba([10, 20, 30, 255]))
            .save(&actual)
            .unwrap();
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(3, 3, Rgba([10, 20, 30, 255]))
            .save(&expected)
            .unwrap();

        let metrics = compare_images(&actual, &expected, None, 0.08).unwrap();
        assert_eq!(metrics.changed_ratio, 0.0);
        assert_eq!(metrics.max_channel_delta, 0);
        assert_eq!(metrics.mean_abs_error, 0.0);
        assert_eq!(metrics.rmse, 0.0);
    }

    #[test]
    fn missing_baseline_returns_err() {
        let dir = tempdir().unwrap();
        let actual = dir.path().join("actual.png");
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]))
            .save(&actual)
            .unwrap();
        let baseline = dir.path().join("does-not-exist.png");

        assert!(matches!(
            compare_images(&actual, &baseline, None, 0.08),
            Err(QaImageError::MissingBaseline { .. })
        ));
    }

    #[test]
    fn corrupt_actual_image_returns_err_without_panic() {
        let dir = tempdir().unwrap();
        let actual = dir.path().join("actual.png");
        let expected = dir.path().join("expected.png");
        fs::write(&actual, b"not a real png").unwrap();
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]))
            .save(&expected)
            .unwrap();

        assert!(matches!(
            compare_images(&actual, &expected, None, 0.08),
            Err(QaImageError::Read { .. })
        ));
    }

    #[test]
    fn reports_dimension_mismatch() {
        let dir = tempdir().unwrap();
        let actual = dir.path().join("actual.png");
        let expected = dir.path().join("expected.png");
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([0, 0, 0, 255]))
            .save(&actual)
            .unwrap();
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(1, 2, Rgba([0, 0, 0, 255]))
            .save(&expected)
            .unwrap();

        assert!(matches!(
            compare_images(&actual, &expected, None, 0.08),
            Err(QaImageError::DimensionMismatch { .. })
        ));
    }
}
