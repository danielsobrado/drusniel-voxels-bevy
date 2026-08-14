use super::macro_world_source::{AzgaarMacroWorldSource, decode_macro_atlas};

#[derive(Debug, Clone, Copy)]
pub struct AzgaarHeightmapOptions {
    pub base_m: f32,
    pub span_m: f32,
}

impl Default for AzgaarHeightmapOptions {
    fn default() -> Self {
        Self {
            base_m: 0.0,
            span_m: 90.0,
        }
    }
}

/// Convert Azgaar raw heights (0–100) into luminance samples in [0, 1].
pub fn azgaar_macro_to_luminance(source: &AzgaarMacroWorldSource) -> Result<Vec<f32>, String> {
    let decoded = decode_macro_atlas(source)?;
    Ok(decoded
        .heights
        .iter()
        .map(|height| f32::from(*height) / 100.0)
        .collect())
}
