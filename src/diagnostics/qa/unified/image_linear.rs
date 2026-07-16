use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Clone, Debug)]
pub struct LinearImage {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<f32>,
}

#[derive(Debug, Error)]
pub enum LinearImageError {
    #[error("failed to read image {path}: {source}")]
    Read {
        path: PathBuf,
        source: image::ImageError,
    },
    #[error("mask dimensions {actual:?} do not match image dimensions {expected:?}")]
    MaskDimensionMismatch {
        actual: (u32, u32),
        expected: (u32, u32),
    },
}

pub fn srgb8_to_linear(value: u8) -> f32 {
    let normalized = f32::from(value) / 255.0;
    if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

pub fn linear_to_srgb8(value: f32) -> u8 {
    let clamped = value.clamp(0.0, 1.0);
    let srgb = if clamped <= 0.003_130_8 {
        clamped * 12.92
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    };
    (srgb * 255.0).round().clamp(0.0, 255.0) as u8
}

pub fn rec709_luminance(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

pub fn load_linear_image(path: &Path) -> Result<LinearImage, LinearImageError> {
    let image = image::open(path).map_err(|source| LinearImageError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let image = image.to_rgb8();
    let (width, height) = image.dimensions();
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in image.pixels() {
        rgb.push(srgb8_to_linear(pixel[0]));
        rgb.push(srgb8_to_linear(pixel[1]));
        rgb.push(srgb8_to_linear(pixel[2]));
    }
    Ok(LinearImage { width, height, rgb })
}

pub fn load_mask(
    path: &Path,
    expected_width: u32,
    expected_height: u32,
) -> Result<Vec<f32>, LinearImageError> {
    let image = image::open(path).map_err(|source| LinearImageError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let image = image.to_luma8();
    let dimensions = image.dimensions();
    if dimensions != (expected_width, expected_height) {
        return Err(LinearImageError::MaskDimensionMismatch {
            actual: dimensions,
            expected: (expected_width, expected_height),
        });
    }
    Ok(image
        .pixels()
        .map(|pixel| f32::from(pixel[0]) / 255.0)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_color_space_samples() {
        assert_eq!(srgb8_to_linear(0), 0.0);
        assert_eq!(srgb8_to_linear(255), 1.0);
        assert!((rec709_luminance(1.0, 1.0, 1.0) - 1.0).abs() < 1e-6);
        assert_eq!(linear_to_srgb8(0.0), 0);
        assert_eq!(linear_to_srgb8(1.0), 255);
    }
}
