// Water Caustics Shader
// Generates animated light caustic patterns for underwater surfaces
//
// Based on GPU-based caustic rendering techniques

#define_import_path water_caustics

const PI: f32 = 3.14159265359;

// Caustic pattern using overlapping sine waves
fn caustic_pattern(position: vec2<f32>, time: f32) -> f32 {
    // Multiple layers of caustic waves
    var caustic = 0.0;
    
    // Layer 1
    let p1 = position * 0.5;
    let t1 = time * 0.8;
    caustic += pow(
        0.5 + 0.5 * sin(p1.x * 3.0 + t1) * sin(p1.y * 4.0 - t1 * 0.7),
        3.0
    );
    
    // Layer 2 - rotated
    let angle = 0.7;
    let c = cos(angle);
    let s = sin(angle);
    let p2 = vec2<f32>(
        position.x * c - position.y * s,
        position.x * s + position.y * c
    ) * 0.7;
    let t2 = time * 1.1;
    caustic += pow(
        0.5 + 0.5 * sin(p2.x * 2.5 + t2) * sin(p2.y * 3.5 + t2 * 0.5),
        3.0
    );
    
    // Layer 3 - smaller detail
    let p3 = position * 1.2;
    let t3 = time * 0.6;
    caustic += pow(
        0.5 + 0.5 * sin(p3.x * 5.0 - t3) * sin(p3.y * 6.0 + t3 * 1.3),
        4.0
    ) * 0.5;
    
    return caustic / 2.5;
}

// Voronoi-based caustic pattern (more realistic)
fn voronoi_caustic(position: vec2<f32>, time: f32) -> f32 {
    let scaled_pos = position * 0.3;
    let animated_pos = scaled_pos + vec2<f32>(time * 0.1, time * 0.05);
    
    let cell = floor(animated_pos);
    let frac = fract(animated_pos);
    
    var min_dist = 10.0;
    var second_min = 10.0;
    
    // Check 3x3 neighborhood
    for (var y: i32 = -1; y <= 1; y = y + 1) {
        for (var x: i32 = -1; x <= 1; x = x + 1) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let cell_pos = cell + neighbor;
            
            // Random point in cell (animated)
            let random = fract(sin(vec2<f32>(
                dot(cell_pos, vec2<f32>(127.1, 311.7)),
                dot(cell_pos, vec2<f32>(269.5, 183.3))
            )) * 43758.5453);
            
            let point = neighbor + random + 
                vec2<f32>(sin(time + random.x * 6.28), cos(time + random.y * 6.28)) * 0.3;
            
            let dist = length(frac - point);
            
            if dist < min_dist {
                second_min = min_dist;
                min_dist = dist;
            } else if dist < second_min {
                second_min = dist;
            }
        }
    }
    
    // Edge detection creates caustic lines
    let edge = second_min - min_dist;
    return pow(edge * 2.0, 0.5);
}

// Combined caustic calculation
fn calculate_caustics(
    world_position: vec3<f32>,
    water_surface_y: f32,
    time: f32,
    caustic_intensity: f32,
    caustic_scale: f32,
) -> f32 {
    // Only render caustics underwater
    if world_position.y > water_surface_y {
        return 0.0;
    }
    
    // Depth attenuation
    let depth = water_surface_y - world_position.y;
    let depth_falloff = exp(-depth * 0.1);
    
    // Project position onto water surface for caustic lookup
    let surface_pos = world_position.xz / caustic_scale;
    
    // Combine both caustic patterns
    let pattern1 = caustic_pattern(surface_pos, time);
    let voronoi = voronoi_caustic(surface_pos, time * 0.5);
    
    let combined = mix(pattern1, voronoi, 0.5);
    
    return combined * depth_falloff * caustic_intensity;
}

// Caustic color (slightly blue-green tint)
fn caustic_color(intensity: f32) -> vec3<f32> {
    let base_color = vec3<f32>(0.8, 0.95, 1.0);
    return base_color * intensity;
}
