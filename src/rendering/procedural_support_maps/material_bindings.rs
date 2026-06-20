use super::config::ProceduralSupportMapConfig;
use super::manifest::ProceduralSupportMapManifest;
use bevy::prelude::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProceduralSupportMapSource {
    GeneratedRuntime,
    CachedAsset,
}

#[derive(Clone, Resource)]
pub struct ProceduralTerrainSupportMapHandles {
    pub noise_a: Handle<Image>,
    pub noise_b: Handle<Image>,
    pub classification_a: Handle<Image>,
    pub config: ProceduralSupportMapConfig,
    pub manifest: ProceduralSupportMapManifest,
    pub source: ProceduralSupportMapSource,
}
