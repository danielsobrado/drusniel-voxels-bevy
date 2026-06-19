//! Stone material setup.
//!
//! The procedural rock meshes already carry `ATTRIBUTE_VDATA` for strata, moss/upness and
//! cavity AO. Runtime currently uses a high-roughness `StandardMaterial`; a custom shader can
//! consume the attribute later without changing mesh/scatter contracts.

use bevy::prelude::*;

pub fn stone_standard_material() -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgb(0.46, 0.45, 0.42),
        perceptual_roughness: 0.95,
        metallic: 0.0,
        ..default()
    }
}
