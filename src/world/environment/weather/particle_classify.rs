pub fn is_weather_water_particle(color: [f32; 3], alpha: f32) -> bool {
    let [r, g, b] = color;
    let brightness = r.max(g).max(b);
    let blue_green = (g + b) * 0.5;
    alpha > 0.05
        && alpha < 0.95
        && brightness > 0.12
        && b >= r * 1.08
        && b >= g * 0.75
        && blue_green > r * 1.2
}

pub fn is_weather_rain_particle(color: [f32; 3], alpha: f32) -> bool {
    is_weather_water_particle(color, alpha) && alpha <= 0.65 && luminance(color) < 0.82
}

pub fn is_weather_snow_particle(color: [f32; 3], alpha: f32) -> bool {
    let [r, g, b] = color;
    let min_channel = r.min(g).min(b);
    let max_channel = r.max(g).max(b);
    alpha > 0.1 && luminance(color) > 0.65 && min_channel > 0.45 && max_channel - min_channel < 0.18
}

fn luminance(color: [f32; 3]) -> f32 {
    color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_blue_translucent_water_particle() {
        assert!(is_weather_water_particle([0.22, 0.45, 0.68], 0.45));
        assert!(is_weather_rain_particle([0.22, 0.45, 0.68], 0.45));
    }

    #[test]
    fn rejects_opaque_or_red_water_candidates() {
        assert!(!is_weather_water_particle([0.22, 0.45, 0.68], 0.99));
        assert!(!is_weather_water_particle([0.75, 0.30, 0.22], 0.45));
    }

    #[test]
    fn classifies_bright_neutral_snow_particle() {
        assert!(is_weather_snow_particle([0.84, 0.88, 0.92], 0.55));
    }

    #[test]
    fn rejects_colored_or_too_dim_snow_candidates() {
        assert!(!is_weather_snow_particle([0.52, 0.56, 0.92], 0.55));
        assert!(!is_weather_snow_particle([0.35, 0.36, 0.38], 0.55));
    }
}
