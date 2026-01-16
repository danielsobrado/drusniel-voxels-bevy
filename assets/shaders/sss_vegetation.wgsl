// Subsurface Scattering utilities for vegetation
// Wrap lighting approximation for fast, convincing SSS on foliage

struct SssParams {
    wrap: f32,              // Wrap amount (0.0-1.0), typically 0.5
    thickness: f32,         // Material thickness (0.0-1.0)
    sss_color: vec3<f32>,   // Subsurface color (typically green/yellow for plants)
    strength: f32,          // SSS effect strength
};

// Wrap lighting - simulates light wrapping around thin surfaces
// Based on "Fast Subsurface Scattering" technique
fn wrap_lighting(
    n_dot_l: f32,
    wrap: f32,
) -> f32 {
    // Shift and scale dot product to allow back-lighting
    return saturate((n_dot_l + wrap) / (1.0 + wrap));
}

// Full SSS calculation with color
fn calculate_subsurface_scattering(
    normal: vec3<f32>,
    light_dir: vec3<f32>,
    view_dir: vec3<f32>,
    light_color: vec3<f32>,
    params: SssParams,
) -> vec3<f32> {
    let n_dot_l = dot(normal, light_dir);
    
    // Standard front lighting
    let front_lighting = max(n_dot_l, 0.0);
    
    // Back lighting (subsurface)
    let back_n_dot_l = dot(normal, -light_dir);
    let wrapped_back = wrap_lighting(back_n_dot_l, params.wrap);
    
    // Thickness modulation (thin parts transmit more light)
    let transmission = pow(wrapped_back, params.thickness + 1.0);
    
    // View-dependent SSS (stronger when viewing from light direction)
    let v_dot_l = dot(view_dir, light_dir);
    let rim = pow(1.0 - abs(n_dot_l), 2.0);
    let view_sss = max(v_dot_l, 0.0) * rim;
    
    // Combine transmission and view-dependent effects
    let sss_amount = (transmission + view_sss) * params.strength;
    let sss_contribution = params.sss_color * light_color * sss_amount;
    
    return sss_contribution;
}

// Simplified SSS for performance (vegetation-specific)
fn vegetation_sss(
    normal: vec3<f32>,
    light_dir: vec3<f32>,
    light_color: vec3<f32>,
    base_color: vec3<f32>,
    wrap_amount: f32,
    sss_strength: f32,
) -> vec3<f32> {
    // Front lighting
    let n_dot_l = dot(normal, light_dir);
    let diffuse = max(n_dot_l, 0.0);
    
    // Wrap lighting for SSS
    let wrapped = wrap_lighting(n_dot_l, wrap_amount);
    
    // SSS color is derived from base color with yellow/green tint
    let sss_color = base_color * vec3<f32>(1.2, 1.1, 0.7);
    
    // Combine diffuse and SSS
    let front = base_color * diffuse * light_color;
    let sss = sss_color * wrapped * sss_strength * light_color;
    
    return front + sss;
}

// Simplified single-value SSS (for alpha-blended grass blades)
fn simple_wrap_lighting(
    normal: vec3<f32>,
    light_dir: vec3<f32>,
    wrap_amount: f32,
) -> f32 {
    let n_dot_l = dot(normal, light_dir);
    return wrap_lighting(n_dot_l, wrap_amount);
}

// Two-sided lighting for thin foliage (leaves, grass)
fn two_sided_lighting(
    normal: vec3<f32>,
    light_dir: vec3<f32>,
    front_strength: f32,
    back_strength: f32,
) -> f32 {
    let n_dot_l = dot(normal, light_dir);
    let front = max(n_dot_l, 0.0) * front_strength;
    let back = max(-n_dot_l, 0.0) * back_strength;
    return front + back;
}
