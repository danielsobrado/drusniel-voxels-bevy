use serde::Deserialize;
use voxel_builder::config::loader::{ConfigError, load_config};

#[derive(Debug, Deserialize, PartialEq)]
struct AppConfig {
    name: String,
    max_players: u32,
    dedicated: bool,
}

#[test]
fn load_config_reads_valid_yaml() {
    let tmp_dir = tempfile::tempdir().expect("create temp dir");
    let config_path = tmp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        r#"
name: sandbox
max_players: 8
dedicated: true
"#,
    )
    .expect("write config");

    let config: AppConfig = load_config(&config_path).expect("config should load");

    assert_eq!(
        config,
        AppConfig {
            name: "sandbox".to_string(),
            max_players: 8,
            dedicated: true,
        }
    );
}

#[test]
fn load_config_surfaces_io_errors() {
    let missing_path = std::path::PathBuf::from("/nonexistent/config.yaml");
    let result: Result<AppConfig, ConfigError> = load_config(&missing_path);

    match result {
        Err(ConfigError::Io(_)) => {}
        _ => panic!("expected IO error for missing file"),
    }
}

#[test]
fn load_config_surfaces_yaml_errors() {
    let tmp_file = tempfile::NamedTempFile::new().expect("create temp file");
    std::fs::write(tmp_file.path(), "not: valid: yaml: [").expect("write invalid yaml");

    let result: Result<AppConfig, ConfigError> = load_config(tmp_file.path());

    match result {
        Err(ConfigError::Yaml(_)) => {}
        _ => panic!("expected YAML error for invalid content"),
    }
}
