use super::*;

pub(super) fn load_probe_image(path: &Path) -> Option<ProbeImage> {
    let image = image::ImageReader::open(path)
        .ok()?
        .decode()
        .ok()?
        .to_rgba8();
    let (width, height) = image.dimensions();
    Some(ProbeImage {
        path: path.to_path_buf(),
        width,
        height,
        pixels: image.into_raw(),
    })
}

pub(super) fn latest_matching_terrain_debug_screenshot(
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
) -> Option<PathBuf> {
    latest_matching_terrain_debug_screenshot_in_dir(Path::new("debug"), camera_pos, camera_forward)
}

pub(super) fn latest_matching_terrain_debug_screenshot_in_dir(
    output_dir: &Path,
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
) -> Option<PathBuf> {
    let camera_pos = camera_pos?;
    let camera_forward = camera_forward?.normalize_or_zero();
    if camera_forward == Vec3::ZERO {
        return None;
    }
    let mut candidates = fs::read_dir(output_dir)
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let file_name = path.file_name()?.to_str()?;
            if !file_name.starts_with("wireframe-") || path.extension()?.to_str()? != "json" {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let now = SystemTime::now();
    for (sidecar_path, modified) in candidates.into_iter().take(20) {
        if let Ok(age) = now.duration_since(modified) {
            if age.as_secs() > TERRAIN_DEBUG_CAPTURE_MAX_AGE_SECS {
                continue;
            }
        }
        let Some(sidecar) = read_terrain_debug_capture_sidecar(&sidecar_path) else {
            continue;
        };
        let capture_camera_pos = Vec3::from_array(sidecar.camera_pos);
        if capture_camera_pos.distance(camera_pos) > TERRAIN_DEBUG_CAPTURE_CAMERA_EPSILON {
            continue;
        }
        if !terrain_debug_capture_matches_camera_forward(&sidecar, camera_forward) {
            continue;
        }
        let png_path = sidecar_path.with_extension("png");
        if png_path.is_file() {
            return Some(png_path);
        }
    }
    None
}

pub(super) fn read_terrain_debug_capture_sidecar(
    path: &Path,
) -> Option<TerrainDebugCaptureSidecarProbe> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

pub(super) fn terrain_debug_capture_matches_camera_forward(
    sidecar: &TerrainDebugCaptureSidecarProbe,
    camera_forward: Vec3,
) -> bool {
    let Some(capture_forward) = terrain_debug_capture_forward(sidecar) else {
        return false;
    };
    capture_forward.dot(camera_forward) >= TERRAIN_DEBUG_CAPTURE_CAMERA_FORWARD_DOT_MIN
}

pub(super) fn terrain_debug_capture_forward(
    sidecar: &TerrainDebugCaptureSidecarProbe,
) -> Option<Vec3> {
    let [x, y, z, w] = sidecar.camera_rot?;
    let len_sq = x * x + y * y + z * z + w * w;
    if !len_sq.is_finite() || len_sq <= f32::EPSILON {
        return None;
    }
    let inv_len = len_sq.sqrt().recip();
    let rotation = Quat::from_xyzw(x * inv_len, y * inv_len, z * inv_len, w * inv_len);
    let forward = (rotation * Vec3::NEG_Z).normalize_or_zero();
    (forward != Vec3::ZERO).then_some(forward)
}

pub(super) fn visual_samples_for_camera_ray(
    context: Option<&VisualProbeContext>,
    raw_surface_point: Option<Vec3>,
    mesher_iso_point: Option<Vec3>,
    first_any: Option<&CameraRayHit>,
    first_front: Option<&CameraRayHit>,
) -> CameraRayVisualSamples {
    CameraRayVisualSamples {
        raw_surface: raw_surface_point.map(|point| visual_point_probe(context, point)),
        mesher_iso: mesher_iso_point.map(|point| visual_point_probe(context, point)),
        first_any_render_hit: first_any
            .map(|hit| visual_point_probe(context, vec3_from_dump(hit.point))),
        first_front_render_hit: first_front
            .map(|hit| visual_point_probe(context, vec3_from_dump(hit.point))),
    }
}

pub(super) fn visual_point_probe(
    context: Option<&VisualProbeContext>,
    point: Vec3,
) -> VisualPointProbe {
    const VISUAL_PIXEL_WINDOW_RADIUS_PX: u32 = 4;
    const VISUAL_NEARBY_PIXEL_WINDOW_RADIUS_PX: u32 = 18;
    let Some(context) = context else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: None,
            screenshot_path: None,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ProjectionUnavailable,
            note: "camera projection context was unavailable".to_string(),
        };
    };
    let screenshot_path = context
        .screenshot_path
        .map(|path| path.display().to_string());
    let Some((screen_position, target_size)) = project_world_point_to_screen(context, point) else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: None,
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ProjectionUnavailable,
            note: "point could not be projected with the active camera projection".to_string(),
        };
    };
    let screen_dump = Vec2Dump {
        x: screen_position.x,
        y: screen_position.y,
    };
    if screen_position.x < 0.0
        || screen_position.y < 0.0
        || screen_position.x >= target_size.x
        || screen_position.y >= target_size.y
    {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: Some(screen_dump),
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::Offscreen,
            note: "projected point is outside the screenshot".to_string(),
        };
    }
    let Some(image) = context.image else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: Some(screen_dump),
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ScreenshotUnavailable,
            note: "screenshot was not available when the probe ran".to_string(),
        };
    };
    let pixel = sample_probe_image(image, screen_position);
    let pixel_window =
        sample_probe_image_window(image, screen_position, VISUAL_PIXEL_WINDOW_RADIUS_PX);
    let nearby_pixel_window =
        sample_probe_image_window(image, screen_position, VISUAL_NEARBY_PIXEL_WINDOW_RADIUS_PX);
    let classification = pixel
        .map(classify_visual_pixel)
        .unwrap_or(VisualPixelClassification::Offscreen);
    VisualPointProbe {
        world_point: point.into(),
        screen_position: Some(screen_dump),
        screenshot_path,
        pixel,
        pixel_window,
        nearby_pixel_window,
        classification,
        note: "sampled screenshot pixel plus local and nearby pixel windows at the projected probe point"
            .to_string(),
    }
}

pub(super) fn project_world_point_to_screen(
    context: &VisualProbeContext,
    point: Vec3,
) -> Option<(Vec2, Vec2)> {
    let target_size = context
        .image
        .map(|image| Vec2::new(image.width as f32, image.height as f32))
        .or(context.window_size)?;
    if target_size.x <= 0.0 || target_size.y <= 0.0 {
        return None;
    }
    match context.projection {
        Projection::Perspective(perspective) => {
            let to_point = point - context.camera_pos;
            let depth = to_point.dot(context.camera_forward);
            if depth <= 1.0e-4 {
                return None;
            }
            let aspect = target_size.x / target_size.y;
            let half_height = depth * (perspective.fov * 0.5).tan();
            let half_width = half_height * aspect;
            if half_height <= f32::EPSILON || half_width <= f32::EPSILON {
                return None;
            }
            let ndc_x = to_point.dot(context.camera_right) / half_width;
            let ndc_y = to_point.dot(context.camera_up) / half_height;
            Some((
                Vec2::new(
                    (ndc_x + 1.0) * 0.5 * target_size.x,
                    (1.0 - ndc_y) * 0.5 * target_size.y,
                ),
                target_size,
            ))
        }
        Projection::Orthographic(orthographic) => {
            let area = orthographic.area;
            let to_point = point - context.camera_pos;
            let x = to_point.dot(context.camera_right);
            let y = to_point.dot(context.camera_up);
            let ndc_x = ((x - area.min.x) / (area.max.x - area.min.x)) * 2.0 - 1.0;
            let ndc_y = ((y - area.min.y) / (area.max.y - area.min.y)) * 2.0 - 1.0;
            Some((
                Vec2::new(
                    (ndc_x + 1.0) * 0.5 * target_size.x,
                    (1.0 - ndc_y) * 0.5 * target_size.y,
                ),
                target_size,
            ))
        }
        Projection::Custom(_) => None,
    }
}

pub(super) fn sample_probe_image(image: &ProbeImage, screen_position: Vec2) -> Option<RgbaProbe> {
    let x = screen_position.x.floor() as i32;
    let y = screen_position.y.floor() as i32;
    if x < 0 || y < 0 || x >= image.width as i32 || y >= image.height as i32 {
        return None;
    }
    let index = ((y as u32 * image.width + x as u32) * 4) as usize;
    let r = *image.pixels.get(index)?;
    let g = *image.pixels.get(index + 1)?;
    let b = *image.pixels.get(index + 2)?;
    let a = *image.pixels.get(index + 3)?;
    Some(RgbaProbe {
        r,
        g,
        b,
        a,
        luminance: pixel_luminance(r, g, b),
    })
}

pub(super) fn sample_probe_image_window(
    image: &ProbeImage,
    screen_position: Vec2,
    radius_px: u32,
) -> Option<VisualPixelWindowProbe> {
    let center_x = screen_position.x.floor() as i32;
    let center_y = screen_position.y.floor() as i32;
    if center_x < 0
        || center_y < 0
        || center_x >= image.width as i32
        || center_y >= image.height as i32
    {
        return None;
    }

    let radius = radius_px as i32;
    let mut sampled_pixels = 0u32;
    let mut dark_or_missing_pixels = 0u32;
    let mut sky_or_background_pixels = 0u32;
    let mut bright_pixels = 0u32;
    let mut lit_or_non_dark_pixels = 0u32;
    let mut min_luminance = f32::INFINITY;
    let mut max_luminance = f32::NEG_INFINITY;
    let mut luminance_sum = 0.0f32;

    for y in (center_y - radius)..=(center_y + radius) {
        for x in (center_x - radius)..=(center_x + radius) {
            if x < 0 || y < 0 || x >= image.width as i32 || y >= image.height as i32 {
                continue;
            }
            let Some(pixel) = sample_probe_image(image, Vec2::new(x as f32, y as f32)) else {
                continue;
            };
            sampled_pixels = sampled_pixels.saturating_add(1);
            min_luminance = min_luminance.min(pixel.luminance);
            max_luminance = max_luminance.max(pixel.luminance);
            luminance_sum += pixel.luminance;
            if pixel.luminance >= 0.80 {
                bright_pixels = bright_pixels.saturating_add(1);
            }
            match classify_visual_pixel(pixel) {
                VisualPixelClassification::DarkOrMissing => {
                    dark_or_missing_pixels = dark_or_missing_pixels.saturating_add(1);
                }
                VisualPixelClassification::SkyOrBackground => {
                    sky_or_background_pixels = sky_or_background_pixels.saturating_add(1);
                }
                VisualPixelClassification::LitOrNonDark => {
                    lit_or_non_dark_pixels = lit_or_non_dark_pixels.saturating_add(1);
                }
                VisualPixelClassification::Offscreen
                | VisualPixelClassification::ScreenshotUnavailable
                | VisualPixelClassification::ProjectionUnavailable => {}
            }
        }
    }

    if sampled_pixels == 0 {
        return None;
    }

    Some(VisualPixelWindowProbe {
        radius_px,
        sampled_pixels,
        dark_or_missing_pixels,
        sky_or_background_pixels,
        bright_pixels,
        lit_or_non_dark_pixels,
        min_luminance,
        max_luminance,
        luminance_range: max_luminance - min_luminance,
        mean_luminance: luminance_sum / sampled_pixels as f32,
    })
}

pub(super) fn pixel_luminance(r: u8, g: u8, b: u8) -> f32 {
    (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32) / 255.0
}

pub(super) fn classify_visual_pixel(pixel: RgbaProbe) -> VisualPixelClassification {
    if pixel.a < 8 || pixel.luminance < 0.08 {
        VisualPixelClassification::DarkOrMissing
    } else if pixel.b > pixel.r.saturating_add(24)
        && pixel.b > pixel.g.saturating_add(8)
        && pixel.luminance > 0.35
    {
        VisualPixelClassification::SkyOrBackground
    } else {
        VisualPixelClassification::LitOrNonDark
    }
}

pub(super) fn visual_samples_have_dark_geometry(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| sample.classification == VisualPixelClassification::DarkOrMissing)
}

pub(super) fn visual_samples_confirm_non_dark(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| sample.classification == VisualPixelClassification::LitOrNonDark)
}

pub(super) fn visual_samples_show_background(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| {
        sample.classification == VisualPixelClassification::SkyOrBackground
            || sample.pixel_window.is_some_and(|window| {
                window.sky_or_background_pixels > 0
                    || window.bright_pixels > 0
                    || window.luminance_range > 0.45
            })
            || sample.nearby_pixel_window.is_some_and(|window| {
                window.sky_or_background_pixels > 0
                    || window.bright_pixels > 0
                    || window.luminance_range > 0.50
            })
    })
}

pub(super) fn screenshot_overlay_points(
    camera_ray: Option<&CameraRayProbe>,
    camera_ray_fan: Option<&CameraRayFan>,
    active_seam_faces: &[SeamFaceProbe],
) -> Vec<ScreenshotOverlayPointProbe> {
    let mut points = Vec::new();
    if let Some(ray) = camera_ray {
        push_visual_overlay_point(
            &mut points,
            "center.raw_surface",
            ray.visual_samples.raw_surface.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.mesher_iso",
            ray.visual_samples.mesher_iso.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.first_any_hit",
            ray.visual_samples.first_any_render_hit.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.first_front_hit",
            ray.visual_samples.first_front_render_hit.as_ref(),
        );
    }
    if let Some(fan) = camera_ray_fan {
        for gap in &fan.gaps {
            let prefix = format!("fan.{}.{}", gap.grid_x, gap.grid_y);
            push_visual_overlay_point(
                &mut points,
                format!("{prefix}.raw_surface"),
                gap.visual_samples.raw_surface.as_ref(),
            );
            push_visual_overlay_point(
                &mut points,
                format!("{prefix}.mesher_iso"),
                gap.visual_samples.mesher_iso.as_ref(),
            );
        }
    }
    for seam in active_seam_faces {
        for sample in &seam.samples {
            push_visual_overlay_point(
                &mut points,
                format!(
                    "seam.{}.{}.sample_{}_{:.2}_{:.2}",
                    format_ivec3_dump(seam.source_chunk),
                    seam.face,
                    sample.sample_index,
                    sample.face_u,
                    sample.face_v
                ),
                Some(&sample.visual),
            );
        }
    }
    points
}

pub(super) fn push_visual_overlay_point(
    points: &mut Vec<ScreenshotOverlayPointProbe>,
    label: impl Into<String>,
    visual: Option<&VisualPointProbe>,
) {
    let Some(visual) = visual else {
        return;
    };
    points.push(ScreenshotOverlayPointProbe {
        label: label.into(),
        world_point: visual.world_point,
        screen_position: visual.screen_position,
        classification: visual.classification,
    });
}
