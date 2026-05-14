use bevy::prelude::*;

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfStats {
    pub loaded_chunks: u32,
    pub dirty_pending: u32,
    pub dirty_in_flight: u32,
    pub rays_traced: u64,
    pub ray_hits: u64,
    pub ray_misses: u64,
    pub average_steps: f32,
    pub fallback_count: u64,
}

#[derive(Resource, Clone, Debug, PartialEq, Eq)]
pub struct NaadfCacheState {
    pub ready: bool,
    pub warming: bool,
    pub fallback_reason: Option<String>,
}

impl Default for NaadfCacheState {
    fn default() -> Self {
        Self {
            ready: false,
            warming: false,
            fallback_reason: Some("NAADF cache disabled until feature systems build it".into()),
        }
    }
}
