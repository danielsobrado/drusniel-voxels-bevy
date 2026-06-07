use std::collections::HashMap;

/// Logging configuration loaded from YAML.
#[derive(serde::Deserialize, Default)]
struct LoggingConfig {
    #[serde(default = "default_log_level")]
    default_level: String,
    #[serde(default)]
    modules: HashMap<String, String>,
}

fn default_log_level() -> String {
    "info".to_string()
}

/// Load logging configuration from YAML file and generate a filter string.
pub(super) fn load_logging_config() -> String {
    let config_path = "assets/config/logging.yaml";

    let config: LoggingConfig = match std::fs::read_to_string(config_path) {
        Ok(contents) => match serde_yaml::from_str(&contents) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("[LOG] Failed to parse {}: {}", config_path, e);
                LoggingConfig::default()
            }
        },
        Err(e) => {
            eprintln!(
                "[LOG] Failed to read {}: {}, using defaults",
                config_path, e
            );
            LoggingConfig::default()
        }
    };

    // Build filter string: "default_level,module1=level1,module2=level2,..."
    let mut filter_parts = vec![config.default_level.clone()];

    for (module, level) in &config.modules {
        filter_parts.push(format!("{}={}", module, level));
    }

    let filter = filter_parts.join(",");
    eprintln!("[LOG] Filter: {}", filter);
    filter
}
