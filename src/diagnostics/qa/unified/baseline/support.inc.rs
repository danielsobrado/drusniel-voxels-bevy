fn update_manifest_text(
    text: &str,
    hashes: &[(String, String)],
    baseline_version: Option<u32>,
    root_key: &str,
    path: &Path,
) -> Result<(String, Vec<String>), BaselineError> {
    let mut document: YamlValue = serde_yaml::from_str(text).map_err(|source| BaselineError::YamlParse {
        path: path.to_path_buf(),
        source,
    })?;
    let document_mapping = mapping_mut(&mut document, path, "document")?;
    let root = document_mapping
        .get_mut(&YamlValue::String(root_key.to_string()))
        .ok_or_else(|| BaselineError::Authority(format!("{root_key} is missing from {}", path.display())))?;
    let root_mapping = mapping_mut(root, path, root_key)?;
    if let Some(version) = baseline_version {
        root_mapping.insert(
            YamlValue::String("baseline_version".to_string()),
            YamlValue::Number(version.into()),
        );
    }
    let scenes = root_mapping
        .get_mut(&YamlValue::String("scenes".to_string()))
        .and_then(YamlValue::as_sequence_mut)
        .ok_or_else(|| BaselineError::Authority(format!("{root_key}.scenes is missing from {}", path.display())))?;
    let hash_map = hashes.iter().cloned().collect::<std::collections::BTreeMap<_, _>>();
    let mut updated = Vec::new();
    for scene in scenes {
        let scene_mapping = mapping_mut(scene, path, "scene")?;
        let Some(scene_id) = scene_mapping
            .get(&YamlValue::String("id".to_string()))
            .and_then(YamlValue::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some(hash) = hash_map.get(&scene_id) else {
            continue;
        };
        let baseline = scene_mapping
            .get_mut(&YamlValue::String("baseline".to_string()))
            .ok_or_else(|| BaselineError::Authority(format!("scene {scene_id} baseline is missing")))?;
        mapping_mut(baseline, path, "baseline")?.insert(
            YamlValue::String("sha256".to_string()),
            YamlValue::String(hash.clone()),
        );
        let image_gates = scene_mapping
            .get_mut(&YamlValue::String("image_gates".to_string()))
            .ok_or_else(|| BaselineError::Authority(format!("scene {scene_id} image_gates is missing")))?;
        mapping_mut(image_gates, path, "image_gates")?.insert(
            YamlValue::String("required".to_string()),
            YamlValue::Bool(true),
        );
        updated.push(scene_id);
    }
    let output = serde_yaml::to_string(&document).map_err(BaselineError::YamlSerialize)?;
    Ok((output, updated))
}

fn mapping_mut<'a>(
    value: &'a mut YamlValue,
    path: &Path,
    label: &str,
) -> Result<&'a mut Mapping, BaselineError> {
    value.as_mapping_mut().ok_or_else(|| {
        BaselineError::Authority(format!("{label} in {} must be a mapping", path.display()))
    })
}

fn read_json(path: &Path) -> Result<Value, BaselineError> {
    let text = fs::read_to_string(path).map_err(|source| BaselineError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| BaselineError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn git<const N: usize>(root: &Path, args: [&str; N]) -> Result<String, BaselineError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| BaselineError::Authority(format!("failed to run git: {error}")))?;
    if !output.status.success() {
        return authority(format!(
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("artifact");
    path.with_file_name(format!(".{name}.qa-tmp"))
}

fn empty_json_value(value: &Value) -> bool {
    value.is_null() || value.as_str().is_some_and(str::is_empty)
}

fn target_name(target: Target) -> &'static str {
    match target {
        Target::ClodPoc => "clod-poc",
        Target::Bevy => "bevy",
    }
}

fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn authority<T>(message: String) -> Result<T, BaselineError> {
    Err(BaselineError::Authority(message))
}
