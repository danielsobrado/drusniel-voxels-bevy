//! Deterministic dispatch driver for scripted CLOD edit events.
//!
//! This module intentionally does not mutate terrain.  It turns the expanded
//! edit-event CSV from `clod_edit_events_export` into an ordered stream of
//! dispatch records that a Bevy bench/runtime system can consume later.
//! Keeping the driver runtime-neutral lets us validate scheduling before we
//! wire it into the authoritative terrain editing path.

use std::collections::{BTreeMap, VecDeque};

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedEditDispatchInput {
    pub event_index: u32,
    pub occurrence_index: u32,
    pub frame: u32,
    pub name: String,
    pub kind: String,
    pub position: [f32; 3],
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub expected_dirty_pages_min: u32,
    pub expected_dirty_pages_max: u32,
    pub expected_rebuild_publish_max_frames: u32,
    pub expected_collider_refresh_max_frames: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedEditDispatchRecord {
    pub driver_frame: u32,
    pub event_index: u32,
    pub occurrence_index: u32,
    pub source_frame: u32,
    pub name: String,
    pub kind: String,
    pub position: [f32; 3],
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub expected_dirty_pages_min: u32,
    pub expected_dirty_pages_max: u32,
    pub expected_rebuild_publish_max_frames: u32,
    pub expected_collider_refresh_max_frames: u32,
}

#[derive(Debug, Clone, Default)]
pub struct ScriptedEditDriver {
    by_frame: BTreeMap<u32, VecDeque<ScriptedEditDispatchInput>>,
    last_frame: Option<u32>,
    dispatched_count: u64,
}

impl ScriptedEditDriver {
    pub fn new(events: impl IntoIterator<Item = ScriptedEditDispatchInput>) -> Self {
        let mut by_frame: BTreeMap<u32, VecDeque<ScriptedEditDispatchInput>> = BTreeMap::new();
        for event in events {
            by_frame.entry(event.frame).or_default().push_back(event);
        }

        for queue in by_frame.values_mut() {
            queue.make_contiguous().sort_by_key(|event| (event.event_index, event.occurrence_index));
        }

        Self { by_frame, last_frame: None, dispatched_count: 0 }
    }

    pub fn is_empty(&self) -> bool {
        self.by_frame.values().all(VecDeque::is_empty)
    }

    pub fn dispatched_count(&self) -> u64 {
        self.dispatched_count
    }

    pub fn next_frame(&self) -> Option<u32> {
        self.by_frame
            .iter()
            .find_map(|(frame, queue)| (!queue.is_empty()).then_some(*frame))
    }

    pub fn dispatch_frame(&mut self, frame: u32) -> Result<Vec<ScriptedEditDispatchRecord>, String> {
        if let Some(last_frame) = self.last_frame {
            if frame < last_frame {
                return Err(format!(
                    "scripted CLOD edit driver cannot run backwards: frame {frame} after {last_frame}"
                ));
            }
        }
        self.last_frame = Some(frame);

        let mut out = Vec::new();
        if let Some(queue) = self.by_frame.get_mut(&frame) {
            while let Some(event) = queue.pop_front() {
                self.dispatched_count += 1;
                out.push(ScriptedEditDispatchRecord {
                    driver_frame: frame,
                    event_index: event.event_index,
                    occurrence_index: event.occurrence_index,
                    source_frame: event.frame,
                    name: event.name,
                    kind: event.kind,
                    position: event.position,
                    radius: event.radius,
                    strength: event.strength,
                    target_height: event.target_height,
                    expected_dirty_pages_min: event.expected_dirty_pages_min,
                    expected_dirty_pages_max: event.expected_dirty_pages_max,
                    expected_rebuild_publish_max_frames: event.expected_rebuild_publish_max_frames,
                    expected_collider_refresh_max_frames: event.expected_collider_refresh_max_frames,
                });
            }
        }
        Ok(out)
    }

    pub fn dispatch_until(&mut self, max_frame: u32) -> Result<Vec<ScriptedEditDispatchRecord>, String> {
        let mut out = Vec::new();
        for frame in 0..=max_frame {
            out.extend(self.dispatch_frame(frame)?);
        }
        Ok(out)
    }
}

pub fn dispatch_csv_header() -> &'static str {
    "driver_frame,event_index,occurrence_index,source_frame,name,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames"
}

pub fn dispatch_record_to_csv_row(record: &ScriptedEditDispatchRecord) -> String {
    format!(
        "{},{},{},{},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{},{}",
        record.driver_frame,
        record.event_index,
        record.occurrence_index,
        record.source_frame,
        csv_escape(&record.name),
        csv_escape(&record.kind),
        record.position[0],
        record.position[1],
        record.position[2],
        record.radius,
        record.strength,
        record.target_height.map(|value| format!("{value:.6}")).unwrap_or_default(),
        record.expected_dirty_pages_min,
        record.expected_dirty_pages_max,
        record.expected_rebuild_publish_max_frames,
        record.expected_collider_refresh_max_frames,
    )
}

pub fn parse_scripted_edit_event_csv(input: &str) -> Result<Vec<ScriptedEditDispatchInput>, String> {
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next().ok_or_else(|| "empty scripted edit event CSV".to_string())?;
    let columns: Vec<&str> = header.split(',').map(str::trim).collect();

    let mut events = Vec::new();
    for (line_index, line) in lines.enumerate() {
        let values: Vec<&str> = line.split(',').map(str::trim).collect();
        let read = |name: &str| -> Result<&str, String> {
            let index = columns
                .iter()
                .position(|column| *column == name)
                .ok_or_else(|| format!("missing CSV column `{name}`"))?;
            values
                .get(index)
                .copied()
                .ok_or_else(|| format!("line {} missing value for `{name}`", line_index + 2))
        };

        events.push(ScriptedEditDispatchInput {
            event_index: parse_u32(read("event_index")?, "event_index", line_index + 2)?,
            occurrence_index: parse_u32(read("occurrence_index")?, "occurrence_index", line_index + 2)?,
            frame: parse_u32(read("frame")?, "frame", line_index + 2)?,
            name: read("name")?.to_string(),
            kind: read("kind")?.to_string(),
            position: [
                parse_f32(read("x")?, "x", line_index + 2)?,
                parse_f32(read("y")?, "y", line_index + 2)?,
                parse_f32(read("z")?, "z", line_index + 2)?,
            ],
            radius: parse_f32(read("radius")?, "radius", line_index + 2)?,
            strength: parse_f32(read("strength")?, "strength", line_index + 2)?,
            target_height: parse_optional_f32(read("target_height").unwrap_or(""), "target_height", line_index + 2)?,
            expected_dirty_pages_min: parse_u32(
                read("expected_dirty_pages_min")?,
                "expected_dirty_pages_min",
                line_index + 2,
            )?,
            expected_dirty_pages_max: parse_u32(
                read("expected_dirty_pages_max")?,
                "expected_dirty_pages_max",
                line_index + 2,
            )?,
            expected_rebuild_publish_max_frames: parse_u32(
                read("expected_rebuild_publish_max_frames")?,
                "expected_rebuild_publish_max_frames",
                line_index + 2,
            )?,
            expected_collider_refresh_max_frames: parse_u32(
                read("expected_collider_refresh_max_frames")?,
                "expected_collider_refresh_max_frames",
                line_index + 2,
            )?,
        });
    }

    Ok(events)
}

fn parse_u32(value: &str, column: &str, line: usize) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))
}

fn parse_f32(value: &str, column: &str, line: usize) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))?;
    if !parsed.is_finite() {
        return Err(format!("line {line} invalid non-finite `{column}` value `{value}`"));
    }
    Ok(parsed)
}

fn parse_optional_f32(value: &str, column: &str, line: usize) -> Result<Option<f32>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    parse_f32(value, column, line).map(Some)
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(frame: u32, event_index: u32, occurrence_index: u32) -> ScriptedEditDispatchInput {
        ScriptedEditDispatchInput {
            event_index,
            occurrence_index,
            frame,
            name: format!("edit-{event_index}-{occurrence_index}"),
            kind: "dig".to_string(),
            position: [1.0, 2.0, 3.0],
            radius: 4.0,
            strength: 0.5,
            target_height: None,
            expected_dirty_pages_min: 1,
            expected_dirty_pages_max: 8,
            expected_rebuild_publish_max_frames: 90,
            expected_collider_refresh_max_frames: 120,
        }
    }

    #[test]
    fn dispatches_only_events_for_current_frame() {
        let mut driver = ScriptedEditDriver::new([event(10, 2, 0), event(5, 1, 0)]);

        assert!(driver.dispatch_frame(4).unwrap().is_empty());
        let at_five = driver.dispatch_frame(5).unwrap();
        assert_eq!(at_five.len(), 1);
        assert_eq!(at_five[0].event_index, 1);

        let at_ten = driver.dispatch_frame(10).unwrap();
        assert_eq!(at_ten.len(), 1);
        assert_eq!(at_ten[0].event_index, 2);
        assert!(driver.is_empty());
    }

    #[test]
    fn dispatch_rejects_backwards_frames() {
        let mut driver = ScriptedEditDriver::new([event(10, 1, 0)]);
        driver.dispatch_frame(10).unwrap();
        assert!(driver.dispatch_frame(9).is_err());
    }

    #[test]
    fn parses_exported_event_csv() {
        let csv = "event_index,occurrence_index,frame,name,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames\n\
0,0,60,dig-ridge,dig,278,66,244,5.5,0.55,,1,8,90,120\n";
        let parsed = parse_scripted_edit_event_csv(csv).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].frame, 60);
        assert_eq!(parsed[0].kind, "dig");
        assert_eq!(parsed[0].target_height, None);
    }
}
