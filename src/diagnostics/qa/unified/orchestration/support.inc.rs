fn write_report(report: &BatteryReport, output_dir: &Path) -> Result<(), OrchestrationError> {
    let json_path = output_dir.join("battery-report.json");
    let markdown_path = output_dir.join("battery-report.md");
    let json = serde_json::to_string_pretty(report).map_err(OrchestrationError::Serialize)?;
    fs::write(&json_path, format!("{json}\n")).map_err(|source| OrchestrationError::WriteReport {
        path: json_path,
        source,
    })?;
    let mut markdown = format!(
        "# Unified QA battery\n\nBattery: `{}`\n\nStatus: **{}**\n\n| Command | Scene | Target | Status | Duration ms |\n|---|---|---|---:|---:|\n",
        report.battery_id, report.status
    );
    for command in &report.commands {
        markdown.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            command.command_id, command.scene_id, command.target, command.status, command.duration_ms
        ));
    }
    if !report.failures.is_empty() {
        markdown.push_str("\n## Failures\n\n");
        for failure in &report.failures {
            markdown.push_str(&format!("- {failure}\n"));
        }
    }
    fs::write(&markdown_path, markdown).map_err(|source| OrchestrationError::WriteReport {
        path: markdown_path,
        source,
    })
}

fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, OrchestrationError> {
    let text = fs::read_to_string(path).map_err(|source| OrchestrationError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_yaml::from_str(&text).map_err(|source| OrchestrationError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn validate_schema(path: &Path, version: u32) -> Result<(), OrchestrationError> {
    if version == SCHEMA_VERSION {
        Ok(())
    } else {
        Err(OrchestrationError::Schema {
            path: path.to_path_buf(),
            version,
        })
    }
}

fn unique_map<T>(items: Vec<T>, kind: &str) -> Result<BTreeMap<String, T>, OrchestrationError>
where
    T: HasId,
{
    let mut output = BTreeMap::new();
    for item in items {
        let id = item.id().to_string();
        if output.insert(id.clone(), item).is_some() {
            return invalid(format!("duplicate {kind} id {id}"));
        }
    }
    Ok(output)
}

trait HasId {
    fn id(&self) -> &str;
}
impl HasId for CommandDefinition { fn id(&self) -> &str { &self.id } }
impl HasId for BatteryLane { fn id(&self) -> &str { &self.id } }
impl HasId for BatteryDefinition { fn id(&self) -> &str { &self.id } }

fn validate_identifier(value: &str, label: &str) -> Result<(), OrchestrationError> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else { return invalid(format!("{label} is empty")); };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return invalid(format!("{label} '{value}' is invalid"));
    }
    if !chars.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || matches!(character, '-' | '_' | '.')) {
        return invalid(format!("{label} '{value}' is invalid"));
    }
    Ok(())
}

fn validate_relative_path(path: &Path, label: &str) -> Result<(), OrchestrationError> {
    if path.is_absolute() || path.components().any(|component| matches!(component, Component::ParentDir)) {
        return invalid(format!("{label} escapes the repository: {}", path.display()));
    }
    Ok(())
}

fn validate_template(
    value: &str,
    declared: &BTreeSet<&str>,
    label: &str,
) -> Result<(), OrchestrationError> {
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else { return invalid(format!("{label} has malformed placeholder syntax")); };
        let name = &after[..end];
        if !PLACEHOLDER_ALLOWLIST.contains(&name) || !declared.contains(name) {
            return invalid(format!("{label} uses undeclared placeholder {name}"));
        }
        rest = &after[end + 1..];
    }
    Ok(())
}

fn substitute(value: &str, context: &TemplateContext) -> Result<String, OrchestrationError> {
    let replacements = [
        ("OUTPUT_DIR", context.output_dir.display().to_string()),
        ("REPOSITORY_ROOT", context.repository_root.display().to_string()),
        ("RUN_INDEX", context.run_index.to_string()),
        ("SCENE_ID", context.scene_id.clone()),
        ("TARGET", target_name(context.target).to_string()),
    ];
    let mut output = value.to_string();
    for (name, replacement) in replacements {
        output = output.replace(&format!("${{{name}}}"), &replacement.replace('\\', "/"));
    }
    if output.contains("${") {
        return invalid(format!("unresolved placeholder in '{value}'"));
    }
    Ok(output)
}

fn resolve_inside(root: &Path, path: &Path, label: &str) -> Result<PathBuf, OrchestrationError> {
    let root = absolute(root)?;
    let candidate = if path.is_absolute() { path.to_path_buf() } else { root.join(path) };
    let candidate = lexical_normalize(&candidate);
    if candidate != root && !candidate.starts_with(&root) {
        return invalid(format!("{label} escapes root: {}", path.display()));
    }
    Ok(candidate)
}

fn resolve_artifact(context: &TemplateContext, value: &str) -> Result<PathBuf, OrchestrationError> {
    resolve_inside(&context.repository_root, Path::new(value), "artifact path")
}

fn absolute(path: &Path) -> Result<PathBuf, OrchestrationError> {
    if path.is_absolute() {
        Ok(lexical_normalize(path))
    } else {
        let cwd = std::env::current_dir().map_err(|source| OrchestrationError::Read {
            path: path.to_path_buf(),
            source,
        })?;
        Ok(lexical_normalize(&cwd.join(path)))
    }
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => { output.pop(); }
            other => output.push(other.as_os_str()),
        }
    }
    output
}

fn platform_program(program: &str) -> String {
    #[cfg(windows)]
    {
        return match program {
            "npm" | "npx" => format!("{program}.cmd"),
            "cargo" => "cargo.exe".to_string(),
            _ => program.to_string(),
        };
    }
    #[cfg(not(windows))]
    program.to_string()
}

fn safe_environment_key(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_uppercase())
        && chars.all(|character| character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_')
}

fn target_name(target: Target) -> &'static str {
    match target {
        Target::ClodPoc => "clod-poc",
        Target::Bevy => "bevy",
    }
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') { character } else { '_' })
        .collect()
}

fn create_dir(path: &Path) -> Result<(), OrchestrationError> {
    fs::create_dir_all(path).map_err(|source| OrchestrationError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn invalid<T>(message: String) -> Result<T, OrchestrationError> {
    Err(OrchestrationError::Invalid(message))
}
