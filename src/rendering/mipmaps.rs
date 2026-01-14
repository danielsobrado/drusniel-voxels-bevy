//! Mipmap generation utilities for proper texture filtering.
//!
//! This module provides CPU-based mipmap generation for textures that need
//! pre-computed mipmaps (like texture arrays where GPU generation is complex).
//! 
//! Mipmaps are pre-computed, progressively smaller versions of a texture that
//! reduce aliasing artifacts when textures are viewed at a distance.

use bevy::render::render_resource::{Extent3d, TextureFormat};

/// Calculate the number of mip levels for a given texture size.
/// 
/// Returns the number of mip levels from the base level down to 1x1.
pub fn calculate_mip_count(width: u32, height: u32) -> u32 {
    let max_dim = width.max(height);
    32 - max_dim.leading_zeros()
}

/// Calculate the number of mip levels for a given texture size, stopping at a minimum size.
/// 
/// # Arguments
/// * `width` - Base texture width
/// * `height` - Base texture height
/// * `min_size` - Minimum dimension for the smallest mip level (e.g., 4 for block compression)
pub fn calculate_mip_count_min(width: u32, height: u32, min_size: u32) -> u32 {
    let mut count = 1u32;
    let mut w = width;
    let mut h = height;
    
    while w / 2 >= min_size && h / 2 >= min_size {
        w /= 2;
        h /= 2;
        count += 1;
    }
    
    count
}

/// Generate mipmaps for a single RGBA8 image in-place.
/// 
/// This uses simple box filtering (average of 2x2 blocks) which is fast
/// and produces acceptable results for most game textures.
/// 
/// # Arguments
/// * `data` - Mutable reference to the image data (will be extended with mip data)
/// * `width` - Base texture width
/// * `height` - Base texture height
/// * `mip_count` - Number of mip levels to generate (including base)
/// 
/// # Returns
/// The total size in bytes of all mip levels combined.
pub fn generate_mipmaps_rgba8(
    data: &mut Vec<u8>,
    width: u32,
    height: u32,
    mip_count: u32,
) -> usize {
    if mip_count <= 1 {
        return data.len();
    }
    
    // Pre-allocate space for all mip levels
    let total_size = calculate_total_mip_size(width, height, mip_count, 4);
    data.reserve(total_size.saturating_sub(data.len()));
    
    // Track where each mip level starts
    let mut prev_offset = 0usize;
    let mut prev_width = width as usize;
    let mut prev_height = height as usize;
    
    for _level in 1..mip_count {
        let current_width = (prev_width / 2).max(1);
        let current_height = (prev_height / 2).max(1);
        
        // Generate this mip level using box filter from previous level
        for y in 0..current_height {
            for x in 0..current_width {
                let src_x = x * 2;
                let src_y = y * 2;
                
                // Sample 2x2 block from previous level
                let mut r = 0u32;
                let mut g = 0u32;
                let mut b = 0u32;
                let mut a = 0u32;
                
                for dy in 0..2 {
                    for dx in 0..2 {
                        let sx = (src_x + dx).min(prev_width.saturating_sub(1));
                        let sy = (src_y + dy).min(prev_height.saturating_sub(1));
                        let idx = prev_offset + (sy * prev_width + sx) * 4;
                        
                        if idx + 3 < data.len() {
                            r += data[idx] as u32;
                            g += data[idx + 1] as u32;
                            b += data[idx + 2] as u32;
                            a += data[idx + 3] as u32;
                        }
                    }
                }
                
                // Average and write to current level
                data.push((r / 4) as u8);
                data.push((g / 4) as u8);
                data.push((b / 4) as u8);
                data.push((a / 4) as u8);
            }
        }
        
        // Move to next level: previous becomes current
        prev_offset += prev_width * prev_height * 4;
        prev_width = current_width;
        prev_height = current_height;
    }
    
    total_size
}

/// Calculate the total size in bytes needed for all mip levels.
pub fn calculate_total_mip_size(width: u32, height: u32, mip_count: u32, bytes_per_pixel: u32) -> usize {
    let mut total = 0usize;
    let mut w = width as usize;
    let mut h = height as usize;
    
    for _ in 0..mip_count {
        total += w * h * bytes_per_pixel as usize;
        w = (w / 2).max(1);
        h = (h / 2).max(1);
    }
    
    total
}

/// Generate mipmaps for a 2D texture array.
/// 
/// This generates mipmaps for each layer of a texture array independently,
/// then interleaves them in the correct order for GPU consumption.
/// 
/// # Arguments
/// * `width` - Base texture width (same for all layers)
/// * `height` - Base texture height (same for all layers)
/// * `layers` - Number of array layers
/// * `layer_data` - Vector of raw pixel data for each layer (RGBA8)
/// * `mip_count` - Number of mip levels to generate
/// 
/// # Returns
/// Combined data for all layers with all mip levels in LayerMajor order.
/// Layout: [layer0_mip0, layer0_mip1, ..., layer1_mip0, layer1_mip1, ...]
pub fn generate_array_mipmaps_rgba8(
    width: u32,
    height: u32,
    layers: u32,
    layer_data: &[Vec<u8>],
    mip_count: u32,
) -> Vec<u8> {
    // Generate mipmaps for each layer and concatenate (LayerMajor order)
    // This matches TextureDataOrder::LayerMajor (the default)
    let expected_total_per_layer = calculate_total_mip_size(width, height, mip_count, 4);
    let mut result = Vec::with_capacity(expected_total_per_layer * layers as usize);
    
    for layer_idx in 0..layers as usize {
        let mut data = layer_data[layer_idx].clone();
        generate_mipmaps_rgba8(&mut data, width, height, mip_count);
        result.extend_from_slice(&data);
    }
    
    result
}

/// Check if a texture format supports mipmap generation.
pub fn supports_mipmaps(format: TextureFormat) -> bool {
    matches!(
        format,
        TextureFormat::Rgba8Unorm
            | TextureFormat::Rgba8UnormSrgb
            | TextureFormat::Bgra8Unorm
            | TextureFormat::Bgra8UnormSrgb
            | TextureFormat::R8Unorm
            | TextureFormat::Rg8Unorm
            | TextureFormat::Rgba16Float
            | TextureFormat::Rgba32Float
    )
}

/// Get the size of a specific mip level.
pub fn mip_level_size(base_width: u32, base_height: u32, level: u32) -> Extent3d {
    let divisor = 1u32 << level;
    Extent3d {
        width: (base_width / divisor).max(1),
        height: (base_height / divisor).max(1),
        depth_or_array_layers: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_mip_count_calculation() {
        assert_eq!(calculate_mip_count(1, 1), 1);
        assert_eq!(calculate_mip_count(2, 2), 2);
        assert_eq!(calculate_mip_count(4, 4), 3);
        assert_eq!(calculate_mip_count(256, 256), 9);
        assert_eq!(calculate_mip_count(1024, 1024), 11);
        assert_eq!(calculate_mip_count(512, 256), 10); // max(512, 256) = 512
    }
    
    #[test]
    fn test_mip_count_with_minimum() {
        assert_eq!(calculate_mip_count_min(256, 256, 4), 7); // 256 -> 128 -> 64 -> 32 -> 16 -> 8 -> 4
        assert_eq!(calculate_mip_count_min(256, 256, 1), 9);
    }
    
    #[test]
    fn test_total_mip_size() {
        // 4x4 texture with 3 mip levels: 4x4 + 2x2 + 1x1 = 16 + 4 + 1 = 21 pixels
        assert_eq!(calculate_total_mip_size(4, 4, 3, 4), 21 * 4);
    }
    
    #[test]
    fn test_mipmap_generation() {
        // Create a simple 4x4 white texture
        let mut data = vec![255u8; 4 * 4 * 4];
        generate_mipmaps_rgba8(&mut data, 4, 4, 3);
        
        // Should have 4x4 + 2x2 + 1x1 = 21 pixels * 4 bytes
        assert_eq!(data.len(), 21 * 4);
        
        // All values should still be 255 (white averaged is still white)
        for byte in &data {
            assert_eq!(*byte, 255);
        }
    }
}
