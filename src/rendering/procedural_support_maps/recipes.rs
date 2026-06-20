use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProceduralMaterialId {
    Grass,
    Rock,
    Sand,
    Snow,
    Dirt,
    Moss,
    Gravel,
    WetSoil,
}

impl ProceduralMaterialId {
    pub const BEVY_TERRAIN_SLOTS: [Self; 4] = [Self::Grass, Self::Rock, Self::Sand, Self::Dirt];

    pub fn cache_name(self) -> &'static str {
        match self {
            Self::Grass => "grass",
            Self::Rock => "rock",
            Self::Sand => "sand",
            Self::Snow => "snow",
            Self::Dirt => "dirt",
            Self::Moss => "moss",
            Self::Gravel => "gravel",
            Self::WetSoil => "wet_soil",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProceduralMaterialRecipe {
    pub base_color: [f32; 3],
    pub roughness: f32,
    pub macro_strength: f32,
    pub normal_strength: f32,
    #[serde(default)]
    pub strata_strength: Option<f32>,
    #[serde(default)]
    pub moisture_bias: Option<f32>,
    #[serde(default)]
    pub sparkle_strength: Option<f32>,
}

impl ProceduralMaterialRecipe {
    pub const fn new(
        base_color: [f32; 3],
        roughness: f32,
        macro_strength: f32,
        normal_strength: f32,
    ) -> Self {
        Self {
            base_color,
            roughness,
            macro_strength,
            normal_strength,
            strata_strength: None,
            moisture_bias: None,
            sparkle_strength: None,
        }
    }
}
