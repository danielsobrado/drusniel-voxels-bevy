pub fn promote_baselines(
    registry: &Registry,
    options: &BaselineOptions,
) -> Result<Vec<BaselineAuthority>, BaselineError> {
    if !options.approve {
        return Err(BaselineError::ApprovalRequired);
    }
    if std::env::var_os("CI").is_some() && !options.allow_ci {
        return Err(BaselineError::CiForbidden);
    }
    let git = verify_git_authority_inner(&options.repository_root)?;
    let environment_path = options.run_root.join("environment.json");
    let environment = read_json(&environment_path)?;
    validate_environment(&environment, &git)?;
    let selected = select_scenes(registry, &options.scene_ids)?;
    let target = one_target(&selected)?;
    if environment.get("target").and_then(Value::as_str) != Some(target_name(target)) {
        return authority(format!(
            "run target {:?} does not match selected target {}",
            environment.get("target"),
            target_name(target)
        ));
    }
    for key in ["os_version", "gpu_adapter", "gpu_backend"] {
        if environment.get(key).is_none_or(empty_json_value) {
            return authority(format!("authoritative environment is missing {key}"));
        }
    }
    if target == Target::ClodPoc && environment.get("browser_version").is_none_or(empty_json_value) {
        return authority("authoritative CLOD environment is missing browser_version".to_string());
    }

    let next_version = registry.baseline_version + 1;
    let promotions = build_promotions(&selected, options)?;
    let hashes = promotions
        .iter()
        .map(|promotion| (promotion.scene.id.clone(), promotion.image_hash.clone()))
        .collect::<Vec<_>>();
    let visual_text = fs::read_to_string(&options.visual_manifest).map_err(|source| BaselineError::Read {
        path: options.visual_manifest.clone(),
        source,
    })?;
    let performance_text = fs::read_to_string(&options.performance_manifest).map_err(|source| BaselineError::Read {
        path: options.performance_manifest.clone(),
        source,
    })?;
    let (updated_visual, visual_ids) = update_manifest_text(
        &visual_text,
        &hashes,
        Some(next_version),
        "visual_regression",
        &options.visual_manifest,
    )?;
    let (updated_performance, performance_ids) = update_manifest_text(
        &performance_text,
        &hashes,
        None,
        "performance_regression",
        &options.performance_manifest,
    )?;
    let updated = visual_ids.into_iter().chain(performance_ids).collect::<std::collections::BTreeSet<_>>();
    let missing = hashes
        .iter()
        .map(|(scene_id, _)| scene_id)
        .filter(|scene_id| !updated.contains(*scene_id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return authority(format!(
            "selected scenes are missing from canonical manifests: {}",
            missing.join(", ")
        ));
    }

    stage_promotions(&promotions)?;
    replace_promotions(&promotions)?;
    atomic_write(&options.visual_manifest, updated_visual.as_bytes())?;
    atomic_write(&options.performance_manifest, updated_performance.as_bytes())?;

    let authorities = promotions
        .iter()
        .map(|promotion| BaselineAuthority {
            schema_version: 1,
            scene_id: promotion.scene.id.clone(),
            target: target_name(promotion.scene.target).to_string(),
            repository_commit_sha: git.head.clone(),
            branch: git.branch.clone(),
            working_tree_dirty: false,
            baseline_version: next_version,
            image_sha256: promotion.image_hash.clone(),
            manifest_sha256: registry.manifest_hash.clone(),
            environment: environment.clone(),
            promoted_unix_ms: unix_ms(),
        })
        .collect::<Vec<_>>();
    for (promotion, authority) in promotions.iter().zip(&authorities) {
        let baseline_dir = promotion.image_target.parent().unwrap_or(&options.repository_root);
        let authority_text = serde_json::to_string_pretty(authority).map_err(BaselineError::Serialize)?;
        fs::write(baseline_dir.join("authority.json"), format!("{authority_text}\n")).map_err(|source| BaselineError::Write {
            path: baseline_dir.join("authority.json"),
            source,
        })?;
        fs::write(
            baseline_dir.join("baseline.sha256"),
            format!("{}  baseline.png\n", promotion.image_hash),
        )
        .map_err(|source| BaselineError::Write {
            path: baseline_dir.join("baseline.sha256"),
            source,
        })?;
    }
    Ok(authorities)
}

pub fn verify_git_authority(repository_root: &Path) -> Result<(String, String), BaselineError> {
    let authority = verify_git_authority_inner(repository_root)?;
    Ok((authority.branch, authority.head))
}

fn verify_git_authority_inner(repository_root: &Path) -> Result<GitAuthority, BaselineError> {
    let branch = git(repository_root, ["branch", "--show-current"])?;
    if branch != "main" {
        return authority(format!("baseline updates require branch main, got {branch}"));
    }
    let status = git(repository_root, ["status", "--porcelain", "--untracked-files=normal"])?;
    if !status.is_empty() {
        return authority("baseline updates require a clean working tree".to_string());
    }
    let head = git(repository_root, ["rev-parse", "HEAD"])?;
    if let Ok(origin_main) = git(repository_root, ["rev-parse", "refs/remotes/origin/main"])
        && origin_main != head
    {
        return authority(format!("HEAD {head} does not match origin/main {origin_main}"));
    }
    Ok(GitAuthority { branch, head })
}

fn validate_environment(environment: &Value, git: &GitAuthority) -> Result<(), BaselineError> {
    if environment.get("authoritative").and_then(Value::as_bool) != Some(true) {
        return authority("run environment is not authoritative".to_string());
    }
    if environment.get("repository_commit_sha").and_then(Value::as_str) != Some(git.head.as_str()) {
        return authority(format!(
            "captured commit {:?} does not match current main {}",
            environment.get("repository_commit_sha"),
            git.head
        ));
    }
    if environment.get("working_tree_dirty").and_then(Value::as_bool) != Some(false) {
        return authority("authoritative capture reports a dirty working tree".to_string());
    }
    Ok(())
}

fn select_scenes(registry: &Registry, ids: &[String]) -> Result<Vec<Scene>, BaselineError> {
    let selected = registry
        .scenes
        .iter()
        .filter(|scene| ids.is_empty() || ids.contains(&scene.id))
        .cloned()
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return authority("no scenes selected for baseline promotion".to_string());
    }
    let unknown = ids
        .iter()
        .filter(|id| !selected.iter().any(|scene| &scene.id == *id))
        .cloned()
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        return authority(format!("unknown baseline scenes: {}", unknown.join(", ")));
    }
    Ok(selected)
}

fn one_target(scenes: &[Scene]) -> Result<Target, BaselineError> {
    let target = scenes[0].target;
    if scenes.iter().any(|scene| scene.target != target) {
        return authority("promote one target per authoritative run root".to_string());
    }
    Ok(target)
}

fn build_promotions(
    scenes: &[Scene],
    options: &BaselineOptions,
) -> Result<Vec<Promotion>, BaselineError> {
    scenes
        .iter()
        .map(|scene| {
            let staged = resolve_staged_scene(&options.run_root, scene)?;
            for (path, label) in [
                (&staged.0, "actual image"),
                (&staged.1, "actual stats"),
                (&staged.2, "actual metrics"),
            ] {
                if !path.is_file() {
                    return authority(format!("{} {} is missing: {}", scene.id, label, path.display()));
                }
            }
            let image_hash = digest_file(&staged.0)?;
            let image_target = options.repository_root.join(&scene.baseline.image);
            let stats_target = options.repository_root.join(&scene.baseline.stats);
            let metrics_target = options.repository_root.join(&scene.baseline.metrics);
            Ok(Promotion {
                scene: scene.clone(),
                source_image: staged.0,
                source_stats: staged.1,
                source_metrics: staged.2,
                image_target,
                stats_target,
                metrics_target,
                image_hash,
            })
        })
        .collect()
}

fn resolve_staged_scene(run_root: &Path, scene: &Scene) -> Result<(PathBuf, PathBuf, PathBuf), BaselineError> {
    let roots = [
        run_root.join("scenes").join(target_name(scene.target)).join(&scene.id),
        run_root.join(target_name(scene.target)).join(&scene.id),
        run_root.join(&scene.id),
    ];
    for root in roots {
        let paths = (
            root.join("actual.png"),
            root.join("actual.stats.json"),
            root.join("actual.metrics.json"),
        );
        if paths.0.exists() || paths.1.exists() || paths.2.exists() {
            return Ok(paths);
        }
    }
    authority(format!("no staged baseline artifacts found for {}", scene.id))
}

fn stage_promotions(promotions: &[Promotion]) -> Result<(), BaselineError> {
    for promotion in promotions {
        for target in [&promotion.image_target, &promotion.stats_target, &promotion.metrics_target] {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|source| BaselineError::CreateDir {
                    path: parent.to_path_buf(),
                    source,
                })?;
            }
        }
        copy_to_temp(&promotion.source_image, &promotion.image_target)?;
        copy_to_temp(&promotion.source_stats, &promotion.stats_target)?;
        copy_to_temp(&promotion.source_metrics, &promotion.metrics_target)?;
    }
    Ok(())
}

fn replace_promotions(promotions: &[Promotion]) -> Result<(), BaselineError> {
    for promotion in promotions {
        replace_temp(&promotion.image_target)?;
        replace_temp(&promotion.stats_target)?;
        replace_temp(&promotion.metrics_target)?;
    }
    Ok(())
}

fn copy_to_temp(source_path: &Path, destination: &Path) -> Result<(), BaselineError> {
    let temp = temp_path(destination);
    fs::copy(source_path, &temp).map_err(|source| BaselineError::Copy {
        source_path: source_path.to_path_buf(),
        destination: temp,
        source,
    })?;
    Ok(())
}

fn replace_temp(destination: &Path) -> Result<(), BaselineError> {
    let temp = temp_path(destination);
    if destination.exists() {
        fs::remove_file(destination).map_err(|source| BaselineError::Rename {
            path: destination.to_path_buf(),
            source,
        })?;
    }
    fs::rename(&temp, destination).map_err(|source| BaselineError::Rename {
        path: destination.to_path_buf(),
        source,
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), BaselineError> {
    let temp = temp_path(path);
    fs::write(&temp, bytes).map_err(|source| BaselineError::Write {
        path: temp.clone(),
        source,
    })?;
    if path.exists() {
        fs::remove_file(path).map_err(|source| BaselineError::Rename {
            path: path.to_path_buf(),
            source,
        })?;
    }
    fs::rename(&temp, path).map_err(|source| BaselineError::Rename {
        path: path.to_path_buf(),
        source,
    })
}
