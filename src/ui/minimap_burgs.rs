//! Azgaar burg selection for the local circular minimap.

pub const MINIMAP_BURG_EDGE_FACTOR: f32 = 2.5;
const MINIMAP_BURG_EDGE_RADIUS: f32 = 0.44;
const DEFAULT_BURG_COLOR: &str = "#f0cf68";

#[derive(Debug, Clone)]
pub struct MinimapBurgSource {
    pub source_width: f32,
    pub source_height: f32,
    pub min_cell_x: i32,
    pub min_cell_z: i32,
    pub width_cells: i32,
    pub height_cells: i32,
}

#[derive(Debug, Clone)]
pub struct MinimapBurgInput {
    pub id: i64,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub state: Option<i64>,
    pub capital: bool,
    pub removed: bool,
}

#[derive(Debug, Clone)]
pub struct MinimapBurgMarker {
    pub id: i64,
    pub name: String,
    pub capital: bool,
    pub color: String,
    pub u: f32,
    pub v: f32,
    pub offscreen: bool,
    pub distance_cells: f32,
}

pub fn burg_to_normalized(x: f32, y: f32, source_width: f32, source_height: f32) -> (f32, f32) {
    (x / source_width, y / source_height)
}

pub fn select_minimap_burgs(
    source: &MinimapBurgSource,
    burgs: &[MinimapBurgInput],
    state_colors: &[(i64, String)],
    center_x: i32,
    center_z: i32,
    cells: i32,
    max_markers: usize,
    edge_factor: f32,
) -> Vec<MinimapBurgMarker> {
    if cells <= 0 || source.source_width <= 0.0 || source.source_height <= 0.0 {
        return Vec::new();
    }
    let half_cells = cells as f32 / 2.0;
    let range_cells = half_cells * edge_factor;
    let mut markers = Vec::new();
    for burg in burgs {
        if burg.removed || !burg.x.is_finite() || !burg.y.is_finite() {
            continue;
        }
        let (nx, nz) =
            burg_to_normalized(burg.x, burg.y, source.source_width, source.source_height);
        let cell_x = source.min_cell_x + (nx * source.width_cells as f32).floor() as i32;
        let cell_z = source.min_cell_z + (nz * source.height_cells as f32).floor() as i32;
        let offset_x = (cell_x - center_x) as f32;
        let offset_z = (cell_z - center_z) as f32;
        let distance_cells = offset_x.hypot(offset_z);
        if distance_cells > range_cells {
            continue;
        }
        let offscreen = offset_x.abs() > half_cells || offset_z.abs() > half_cells;
        let mut u = 0.5 + offset_x / cells as f32;
        let mut v = 0.5 + offset_z / cells as f32;
        if offscreen {
            let scale = (MINIMAP_BURG_EDGE_RADIUS * cells as f32) / distance_cells;
            u = 0.5 + (offset_x / cells as f32) * scale;
            v = 0.5 + (offset_z / cells as f32) * scale;
        }
        let color = burg
            .state
            .and_then(|state| {
                state_colors
                    .iter()
                    .find(|(id, _)| *id == state)
                    .map(|(_, color)| color.clone())
            })
            .unwrap_or_else(|| DEFAULT_BURG_COLOR.to_string());
        markers.push(MinimapBurgMarker {
            id: burg.id,
            name: burg.name.clone(),
            capital: burg.capital,
            color,
            u,
            v,
            offscreen,
            distance_cells,
        });
    }
    markers.sort_by(|a, b| {
        a.distance_cells
            .partial_cmp(&b.distance_cells)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    markers.truncate(max_markers);
    markers
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> MinimapBurgSource {
        MinimapBurgSource {
            source_width: 1000.0,
            source_height: 800.0,
            min_cell_x: -500,
            min_cell_z: -400,
            width_cells: 1000,
            height_cells: 800,
        }
    }

    #[test]
    fn in_window_burg_lands_at_normalized_position() {
        let markers = select_minimap_burgs(
            &source(),
            &[MinimapBurgInput {
                id: 1,
                name: "Harborwatch".into(),
                x: 550.0,
                y: 400.0,
                state: None,
                capital: false,
                removed: false,
            }],
            &[],
            0,
            0,
            192,
            6,
            MINIMAP_BURG_EDGE_FACTOR,
        );
        assert_eq!(markers.len(), 1);
        assert!((markers[0].u - (0.5 + 50.0 / 192.0)).abs() < 1e-5);
        assert!((markers[0].v - 0.5).abs() < 1e-5);
        assert!(!markers[0].offscreen);
    }

    #[test]
    fn nearby_offscreen_burg_clamps_to_rim() {
        let markers = select_minimap_burgs(
            &source(),
            &[MinimapBurgInput {
                id: 1,
                name: "Farhold".into(),
                x: 650.0,
                y: 400.0,
                state: None,
                capital: false,
                removed: false,
            }],
            &[],
            0,
            0,
            192,
            6,
            MINIMAP_BURG_EDGE_FACTOR,
        );
        assert_eq!(markers.len(), 1);
        assert!(markers[0].offscreen);
        assert!((markers[0].u - 0.94).abs() < 1e-4);
    }
}
