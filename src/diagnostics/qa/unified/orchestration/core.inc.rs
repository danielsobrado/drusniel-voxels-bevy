pub fn load_orchestration(
    command_path: &Path,
    battery_path: &Path,
    scenes: Option<&SceneRegistry>,
) -> Result<OrchestrationRegistry, OrchestrationError> {
    let commands_file: CommandManifestFile = read_yaml(command_path)?;
    let batteries_file: BatteryManifestFile = read_yaml(battery_path)?;
    validate_schema(command_path, commands_file.command_allowlist.schema_version)?;
    validate_schema(battery_path, batteries_file.qa_batteries.schema_version)?;

    let commands = unique_map(commands_file.command_allowlist.commands, "command")?;
    let lanes = unique_map(batteries_file.qa_batteries.lanes, "lane")?;
    let batteries = unique_map(batteries_file.qa_batteries.batteries, "battery")?;
    let registry = OrchestrationRegistry { commands, lanes, batteries };
    validate_registry(&registry, scenes)?;
    Ok(registry)
}

pub fn run_battery(
    orchestration: &OrchestrationRegistry,
    scenes: &SceneRegistry,
    options: &BatteryRunOptions,
) -> Result<BatteryReport, OrchestrationError> {
    let battery = orchestration
        .batteries
        .get(&options.battery_id)
        .ok_or_else(|| OrchestrationError::Invalid(format!("unknown QA battery {}", options.battery_id)))?;
    let targets = selected_targets(battery, options.target)?;
    let selected_scenes = select_scenes(battery, scenes, &targets)?;
    let plan = build_plan(orchestration, battery, &selected_scenes, &targets)?;
    create_dir(&options.output_dir)?;

    let mut results = Vec::new();
    let mut failures = Vec::new();
    for item in plan {
        let command = orchestration.commands.get(&item.command_id).ok_or_else(|| {
            OrchestrationError::Invalid(format!("execution plan references unknown command {}", item.command_id))
        })?;
        let context = TemplateContext {
            repository_root: options.repository_root.clone(),
            output_dir: options.output_dir.clone(),
            run_index: options.run_index,
            scene_id: item.scene_id,
            target: item.target,
        };
        let result = run_command(command, &context)?;
        let failed = result.status != "PASS";
        if failed {
            failures.push(format!("{}/{}: {}", result.command_id, result.scene_id, result.status));
        }
        results.push(result);
        if failed && !command.continue_on_failure {
            break;
        }
    }

    let report = BatteryReport {
        schema_version: 1,
        battery_id: battery.id.clone(),
        run_index: options.run_index,
        status: if failures.is_empty() { "PASS" } else { "FAIL" }.to_string(),
        generated_unix_ms: unix_ms(),
        targets: targets.iter().map(|target| target_name(*target).to_string()).collect(),
        scenes: selected_scenes.iter().map(|scene| scene.id.clone()).collect(),
        commands: results,
        failures,
    };
    write_report(&report, &options.output_dir)?;
    Ok(report)
}

pub fn deterministic_artifacts(
    command: &CommandDefinition,
    repository_root: &Path,
    output_dir: &Path,
    run_index: u32,
    scene_id: &str,
    target: Target,
) -> Result<Vec<ArtifactPath>, OrchestrationError> {
    let context = TemplateContext {
        repository_root: repository_root.to_path_buf(),
        output_dir: output_dir.to_path_buf(),
        run_index,
        scene_id: scene_id.to_string(),
        target,
    };
    command
        .artifacts
        .iter()
        .filter(|artifact| artifact.deterministic)
        .map(|artifact| {
            Ok(ArtifactPath {
                path: resolve_artifact(&context, &substitute(&artifact.path, &context)?)?,
                kind: artifact.kind,
                ignore_json_keys: artifact.ignore_json_keys.clone(),
                numeric_tolerance: artifact.numeric_tolerance,
            })
        })
        .collect()
}

fn run_command(
    command: &CommandDefinition,
    context: &TemplateContext,
) -> Result<CommandResult, OrchestrationError> {
    if !command.target.accepts(context.target) {
        return Err(OrchestrationError::Invalid(format!(
            "command {} cannot run for target {}",
            command.id,
            target_name(context.target)
        )));
    }
    let args = command
        .args
        .iter()
        .map(|argument| substitute(argument, context))
        .collect::<Result<Vec<_>, _>>()?;
    let cwd = resolve_inside(&context.repository_root, &command.cwd, "command cwd")?;
    let command_dir = context
        .output_dir
        .join("commands")
        .join(format!("{}-{}", safe_name(&command.id), safe_name(&context.scene_id)));
    create_dir(&command_dir)?;
    let stdout_path = command_dir.join("stdout.log");
    let stderr_path = command_dir.join("stderr.log");
    let stdout = File::create(&stdout_path).map_err(|source| OrchestrationError::CreateLog {
        path: stdout_path.clone(),
        source,
    })?;
    let stderr = File::create(&stderr_path).map_err(|source| OrchestrationError::CreateLog {
        path: stderr_path.clone(),
        source,
    })?;

    let program = platform_program(&command.program);
    let mut process = Command::new(&program);
    process
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    for (key, value) in &command.environment {
        process.env(key, substitute(value, context)?);
    }
    let started = Instant::now();
    let mut child = process.spawn().map_err(|source| OrchestrationError::Spawn {
        command: command.id.clone(),
        source,
    })?;
    let (status, timed_out) = wait_for_child(&mut child, command.timeout_ms, &command.id)?;
    let mut missing_artifacts = Vec::new();
    for artifact in command.artifacts.iter().filter(|artifact| artifact.required) {
        let value = substitute(&artifact.path, context)?;
        let path = resolve_artifact(context, &value)?;
        if !path.exists() {
            missing_artifacts.push(path.display().to_string());
        }
    }
    let result_status = if timed_out {
        "TIMEOUT"
    } else if !status.success() {
        "FAIL"
    } else if !missing_artifacts.is_empty() {
        "ARTIFACT_MISSING"
    } else {
        "PASS"
    };

    Ok(CommandResult {
        command_id: command.id.clone(),
        scene_id: context.scene_id.clone(),
        target: target_name(context.target).to_string(),
        status: result_status.to_string(),
        exit_code: status.code(),
        duration_ms: started.elapsed().as_millis(),
        program,
        args,
        cwd: cwd.display().to_string(),
        stdout_log: stdout_path.display().to_string(),
        stderr_log: stderr_path.display().to_string(),
        missing_artifacts,
    })
}

fn wait_for_child(
    child: &mut Child,
    timeout_ms: u64,
    command_id: &str,
) -> Result<(ExitStatus, bool), OrchestrationError> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Some(status) = child.try_wait().map_err(|source| OrchestrationError::Wait {
            command: command_id.to_string(),
            source,
        })? {
            return Ok((status, false));
        }
        if Instant::now() >= deadline {
            terminate_process_tree(child, command_id)?;
            let status = child.wait().map_err(|source| OrchestrationError::Wait {
                command: command_id.to_string(),
                source,
            })?;
            return Ok((status, true));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn terminate_process_tree(child: &mut Child, command_id: &str) -> Result<(), OrchestrationError> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status()
            .map_err(|source| OrchestrationError::Kill {
                command: command_id.to_string(),
                source,
            })?;
        if status.success() {
            return Ok(());
        }
    }
    child.kill().map_err(|source| OrchestrationError::Kill {
        command: command_id.to_string(),
        source,
    })
}

fn validate_registry(
    registry: &OrchestrationRegistry,
    scenes: Option<&SceneRegistry>,
) -> Result<(), OrchestrationError> {
    for command in registry.commands.values() {
        validate_identifier(&command.id, "command id")?;
        if !PROGRAM_ALLOWLIST.contains(&command.program.as_str()) {
            return invalid(format!("command {} program is not allowlisted: {}", command.id, command.program));
        }
        if command.timeout_ms == 0 {
            return invalid(format!("command {} timeout_ms must be positive", command.id));
        }
        validate_relative_path(&command.cwd, &format!("command {} cwd", command.id))?;
        let declared = command.placeholders.iter().map(String::as_str).collect::<BTreeSet<_>>();
        for placeholder in &declared {
            if !PLACEHOLDER_ALLOWLIST.contains(placeholder) {
                return invalid(format!("command {} declares unsupported placeholder {placeholder}", command.id));
            }
        }
        for argument in &command.args {
            validate_template(argument, &declared, &format!("command {} args", command.id))?;
        }
        for (key, value) in &command.environment {
            if !safe_environment_key(key) {
                return invalid(format!("command {} has unsafe environment key {key}", command.id));
            }
            validate_template(value, &declared, &format!("command {} environment {key}", command.id))?;
        }
        for artifact in &command.artifacts {
            validate_template(&artifact.path, &declared, &format!("command {} artifact", command.id))?;
            if artifact.path != "${OUTPUT_DIR}" && !artifact.path.starts_with("${OUTPUT_DIR}/") {
                return invalid(format!("command {} artifact must stay below OUTPUT_DIR", command.id));
            }
            if !artifact.numeric_tolerance.is_finite() || artifact.numeric_tolerance < 0.0 {
                return invalid(format!("command {} artifact numeric_tolerance is invalid", command.id));
            }
        }
    }

    for lane in registry.lanes.values() {
        validate_identifier(&lane.id, "lane id")?;
        for command_id in &lane.commands {
            let command = registry.commands.get(command_id).ok_or_else(|| {
                OrchestrationError::Invalid(format!("lane {} references unknown command {command_id}", lane.id))
            })?;
            if lane.target != CommandTarget::All
                && command.target != CommandTarget::All
                && lane.target != command.target
            {
                return invalid(format!("lane {} target is incompatible with command {command_id}", lane.id));
            }
        }
    }
    for battery in registry.batteries.values() {
        validate_identifier(&battery.id, "battery id")?;
        if battery.targets.is_empty() {
            return invalid(format!("battery {} must declare at least one target", battery.id));
        }
        for lane_id in &battery.lanes {
            if !registry.lanes.contains_key(lane_id) {
                return invalid(format!("battery {} references unknown lane {lane_id}", battery.id));
            }
        }
    }

    if let Some(scenes) = scenes {
        let scene_map = scenes.scenes.iter().map(|scene| (scene.id.as_str(), scene)).collect::<BTreeMap<_, _>>();
        for scene in &scenes.scenes {
            for command_id in &scene.specialized_commands {
                let command = registry.commands.get(command_id).ok_or_else(|| {
                    OrchestrationError::Invalid(format!("scene {} references unknown specialized command {command_id}", scene.id))
                })?;
                if !command.target.accepts(scene.target) {
                    return invalid(format!("scene {} target is incompatible with command {command_id}", scene.id));
                }
            }
        }
        for battery in registry.batteries.values() {
            for scene_id in &battery.scenes {
                let scene = scene_map.get(scene_id.as_str()).ok_or_else(|| {
                    OrchestrationError::Invalid(format!("battery {} references unknown scene {scene_id}", battery.id))
                })?;
                if !battery.targets.contains(&scene.target) {
                    return invalid(format!("battery {} excludes target used by scene {scene_id}", battery.id));
                }
            }
        }
    }
    Ok(())
}

fn selected_targets(
    battery: &BatteryDefinition,
    requested: Option<Target>,
) -> Result<Vec<Target>, OrchestrationError> {
    if let Some(target) = requested {
        if !battery.targets.contains(&target) {
            return invalid(format!("battery {} does not include target {}", battery.id, target_name(target)));
        }
        return Ok(vec![target]);
    }
    Ok(battery.targets.clone())
}

fn select_scenes<'a>(
    battery: &BatteryDefinition,
    registry: &'a SceneRegistry,
    targets: &[Target],
) -> Result<Vec<&'a Scene>, OrchestrationError> {
    let ids = battery.scenes.iter().map(String::as_str).collect::<BTreeSet<_>>();
    let selected = registry
        .scenes
        .iter()
        .filter(|scene| scene.enabled && targets.contains(&scene.target))
        .filter(|scene| {
            if ids.is_empty() && battery.tags.is_empty() {
                return true;
            }
            ids.contains(scene.id.as_str())
                || (!battery.tags.is_empty()
                    && battery.tags.iter().all(|tag| scene.tags.contains(tag)))
        })
        .collect::<Vec<_>>();
    let missing = battery
        .scenes
        .iter()
        .filter(|id| !selected.iter().any(|scene| &scene.id == *id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return invalid(format!("battery {} has unavailable scenes: {}", battery.id, missing.join(", ")));
    }
    Ok(selected)
}

fn build_plan(
    orchestration: &OrchestrationRegistry,
    battery: &BatteryDefinition,
    scenes: &[&Scene],
    targets: &[Target],
) -> Result<Vec<PlanItem>, OrchestrationError> {
    let mut plan = Vec::new();
    let mut seen = BTreeSet::new();
    for lane_id in &battery.lanes {
        let lane = orchestration.lanes.get(lane_id).ok_or_else(|| {
            OrchestrationError::Invalid(format!("battery {} references unknown lane {lane_id}", battery.id))
        })?;
        for target in targets.iter().copied().filter(|target| lane.target.accepts(*target)) {
            for command_id in &lane.commands {
                push_plan(&mut plan, &mut seen, command_id, "all", target);
            }
        }
    }
    for scene in scenes {
        for command_id in &scene.specialized_commands {
            push_plan(&mut plan, &mut seen, command_id, &scene.id, scene.target);
        }
    }
    Ok(plan)
}

fn push_plan(
    plan: &mut Vec<PlanItem>,
    seen: &mut BTreeSet<String>,
    command_id: &str,
    scene_id: &str,
    target: Target,
) {
    let key = format!("{command_id}:{scene_id}:{}", target_name(target));
    if seen.insert(key) {
        plan.push(PlanItem {
            command_id: command_id.to_string(),
            scene_id: scene_id.to_string(),
            target,
        });
    }
}
