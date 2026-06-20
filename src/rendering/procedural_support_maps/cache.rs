use super::errors::ProceduralSupportMapError;
use super::manifest::ProceduralSupportMapManifest;
use image::ImageFormat;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManifestStatus {
    Missing,
    Stale,
    Match,
}

pub fn cache_root(cache_dir: &str) -> PathBuf {
    Path::new("assets").join(cache_dir)
}

pub fn asset_path(cache_dir: &str, filename: &str) -> String {
    format!("{cache_dir}/{filename}")
}

pub fn manifest_path(cache_dir: &str) -> PathBuf {
    cache_root(cache_dir).join("manifest.json")
}

pub fn bark_cache_name(id: &str) -> String {
    let mut name = String::with_capacity(id.len());
    let mut last_was_underscore = false;
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() {
            name.push(ch.to_ascii_lowercase());
            last_was_underscore = false;
        } else if !last_was_underscore {
            name.push('_');
            last_was_underscore = true;
        }
    }
    let trimmed = name.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "bark".to_string()
    } else {
        trimmed
    }
}

pub fn bark_albedo_filename(id: &str) -> String {
    format!("bark_{}_albedo.png", bark_cache_name(id))
}

pub fn bark_normal_filename(id: &str) -> String {
    format!("bark_{}_normal_roughness_height.png", bark_cache_name(id))
}

pub fn read_manifest(
    cache_dir: &str,
) -> Result<Option<ProceduralSupportMapManifest>, ProceduralSupportMapError> {
    let path = manifest_path(cache_dir);
    if !path.exists() {
        return Ok(None);
    }
    let text =
        fs::read_to_string(&path).map_err(|source| ProceduralSupportMapError::ReadManifest {
            path: path.display().to_string(),
            source,
        })?;
    serde_json::from_str(&text).map(Some).map_err(|source| {
        ProceduralSupportMapError::ParseManifest {
            path: path.display().to_string(),
            source,
        }
    })
}

pub fn manifest_status(
    cache_dir: &str,
    expected: &ProceduralSupportMapManifest,
) -> Result<ManifestStatus, ProceduralSupportMapError> {
    let Some(on_disk) = read_manifest(cache_dir)? else {
        return Ok(ManifestStatus::Missing);
    };
    if on_disk.matches_expected(expected) {
        Ok(ManifestStatus::Match)
    } else {
        Ok(ManifestStatus::Stale)
    }
}

pub fn write_manifest(
    cache_dir: &str,
    manifest: &ProceduralSupportMapManifest,
) -> Result<(), ProceduralSupportMapError> {
    let root = cache_root(cache_dir);
    fs::create_dir_all(&root).map_err(|source| ProceduralSupportMapError::WriteCache {
        path: root.display().to_string(),
        source,
    })?;
    let path = manifest_path(cache_dir);
    let text = serde_json::to_string_pretty(manifest)
        .map_err(ProceduralSupportMapError::SerializeManifest)?;
    fs::write(&path, text).map_err(|source| ProceduralSupportMapError::WriteCache {
        path: path.display().to_string(),
        source,
    })
}

pub fn write_rgba_png(
    cache_dir: &str,
    filename: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(), ProceduralSupportMapError> {
    let root = cache_root(cache_dir);
    fs::create_dir_all(&root).map_err(|source| ProceduralSupportMapError::WriteCache {
        path: root.display().to_string(),
        source,
    })?;
    let path = root.join(filename);
    image::save_buffer_with_format(
        &path,
        rgba,
        width,
        height,
        image::ColorType::Rgba8,
        ImageFormat::Png,
    )
    .map_err(|source| ProceduralSupportMapError::WriteImage {
        path: path.display().to_string(),
        source,
    })
}

pub fn manifest_cache_files_exist(
    cache_dir: &str,
    manifest: &ProceduralSupportMapManifest,
) -> bool {
    let root = cache_root(cache_dir);
    root.join(&manifest.outputs.noise_a).exists()
        && root.join(&manifest.outputs.noise_b).exists()
        && root
            .join(&manifest.outputs.terrain_classification_a)
            .exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_support_maps::config::ProceduralSupportMapConfig;
    use crate::rendering::procedural_support_maps::manifest::ProceduralSupportMapManifest;

    #[test]
    fn manifest_stale_detection_uses_config_hash() {
        let config = ProceduralSupportMapConfig::default();
        let expected = ProceduralSupportMapManifest::expected(&config).expect("manifest");
        let mut stale = expected.clone();
        stale.config_hash = "different".to_string();

        assert!(expected.matches_expected(&expected));
        assert!(!stale.matches_expected(&expected));
    }

    #[test]
    fn auxiliary_cache_filenames_are_stable() {
        assert_eq!(
            bark_albedo_filename("Karst Gnarl"),
            "bark_karst_gnarl_albedo.png"
        );
        assert_eq!(
            bark_normal_filename("snag"),
            "bark_snag_normal_roughness_height.png"
        );
    }

    #[test]
    fn manifest_cache_file_check_includes_noise_outputs() {
        let config = ProceduralSupportMapConfig::default();
        let manifest = ProceduralSupportMapManifest::expected(&config).expect("manifest");

        assert!(!manifest_cache_files_exist(
            "generated/procedural_missing_for_test",
            &manifest
        ));
    }
}
