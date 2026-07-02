use super::material_bindings::ProceduralSupportMapSource;
use bevy::prelude::*;

#[derive(Clone, Debug, Default, Resource)]
pub struct ProceduralSupportMapStatus {
    pub enabled: bool,
    pub ready: bool,
    pub source: Option<ProceduralSupportMapSource>,
    pub manifest_key: Option<String>,
    pub cache_dir: Option<String>,
    pub material_variants_applied: usize,
    pub last_message: String,
}

impl ProceduralSupportMapStatus {
    pub fn disabled(message: impl Into<String>) -> Self {
        Self {
            enabled: false,
            ready: false,
            last_message: message.into(),
            ..default()
        }
    }

    pub fn ready(
        source: ProceduralSupportMapSource,
        manifest_key: impl Into<String>,
        cache_dir: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            enabled: true,
            ready: true,
            source: Some(source),
            manifest_key: Some(manifest_key.into()),
            cache_dir: Some(cache_dir.into()),
            material_variants_applied: 0,
            last_message: message.into(),
        }
    }

    pub fn record_material_variants_applied(&mut self, count: usize) {
        self.material_variants_applied = count;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_status_is_not_ready() {
        let status = ProceduralSupportMapStatus::disabled("off");

        assert!(!status.enabled);
        assert!(!status.ready);
        assert_eq!(status.last_message, "off");
    }

    #[test]
    fn ready_status_tracks_source_and_manifest() {
        let mut status = ProceduralSupportMapStatus::ready(
            ProceduralSupportMapSource::CachedAsset,
            "manifest-key",
            "generated/procedural",
            "loaded",
        );
        status.record_material_variants_applied(3);

        assert!(status.enabled);
        assert!(status.ready);
        assert_eq!(status.source, Some(ProceduralSupportMapSource::CachedAsset));
        assert_eq!(status.manifest_key.as_deref(), Some("manifest-key"));
        assert_eq!(status.material_variants_applied, 3);
    }
}
