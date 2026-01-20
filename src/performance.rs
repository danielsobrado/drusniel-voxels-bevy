use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{create_dir_all, File};
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Resource, Default)]
pub struct AreaTimingRecorder {
    pub enabled: bool,
    frame_index: u32,
    area_us: BTreeMap<&'static str, u64>,
}

impl AreaTimingRecorder {
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !self.enabled {
            self.area_us.clear();
        }
    }

    pub fn reset_frame(&mut self, frame: u32) {
        self.frame_index = frame;
        self.area_us.clear();
    }

    pub fn record(&mut self, frame: u32, area: &'static str, duration_us: u64) {
        if !self.enabled {
            return;
        }
        if self.frame_index != frame {
            self.reset_frame(frame);
        }
        *self.area_us.entry(area).or_insert(0) += duration_us;
    }

    pub fn areas(&self) -> &BTreeMap<&'static str, u64> {
        &self.area_us
    }
}

pub struct AreaTimerGuard<'a> {
    recorder: &'a mut AreaTimingRecorder,
    frame: u32,
    area: &'static str,
    start: Option<Instant>,
}

impl<'a> Drop for AreaTimerGuard<'a> {
    fn drop(&mut self) {
        if let Some(start) = self.start {
            let elapsed_us = start.elapsed().as_micros() as u64;
            self.recorder.record(self.frame, self.area, elapsed_us);
        }
    }
}

pub fn area_timer<'a>(
    recorder: &'a mut AreaTimingRecorder,
    frame: u32,
    area: &'static str,
) -> AreaTimerGuard<'a> {
    let start = if recorder.enabled {
        Some(Instant::now())
    } else {
        None
    };
    AreaTimerGuard {
        recorder,
        frame,
        area,
        start,
    }
}

pub fn reset_area_timing_frame(
    mut recorder: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
) {
    if recorder.enabled {
        recorder.reset_frame(frame.0);
    }
}

#[derive(Resource, Default)]
pub struct AreaTimingCapture {
    pub active: bool,
    start_time: Option<Instant>,
    frames: Vec<AreaTimingFrame>,
    pub last_output: Option<String>,
}

#[derive(Serialize)]
struct AreaTimingFrame {
    frame: u32,
    time_ms: f64,
    areas: Vec<AreaTimingEntry>,
}

#[derive(Serialize)]
struct AreaTimingEntry {
    area: String,
    time_ms: f64,
}

pub fn start_area_trace(capture: &mut AreaTimingCapture) {
    capture.active = true;
    capture.start_time = Some(Instant::now());
    capture.frames.clear();
    capture.last_output = None;
}

pub fn stop_area_trace(capture: &mut AreaTimingCapture) -> Option<PathBuf> {
    if !capture.active {
        return None;
    }
    capture.active = false;
    let path = trace_output_path();
    if let Err(err) = write_trace_file(&path, &capture.frames) {
        warn!("Failed to write area timing trace: {}", err);
        capture.last_output = None;
        capture.frames.clear();
        return None;
    }
    capture.last_output = Some(path.to_string_lossy().to_string());
    capture.frames.clear();
    Some(path)
}

pub fn capture_area_timings(
    recorder: Res<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    mut capture: ResMut<AreaTimingCapture>,
) {
    if !capture.active {
        return;
    }

    let start = capture.start_time.get_or_insert_with(Instant::now);
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut areas = Vec::new();
    for (area, us) in recorder.areas() {
        areas.push(AreaTimingEntry {
            area: (*area).to_string(),
            time_ms: (*us as f64) / 1000.0,
        });
    }

    capture.frames.push(AreaTimingFrame {
        frame: frame.0,
        time_ms: elapsed_ms,
        areas,
    });
}

fn trace_output_path() -> PathBuf {
    let mut path = PathBuf::from("temp");
    let _ = create_dir_all(&path);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    path.push(format!("area_trace_{}.json", timestamp));
    path
}

fn write_trace_file(path: &PathBuf, frames: &[AreaTimingFrame]) -> std::io::Result<()> {
    let file = File::create(path)?;
    serde_json::to_writer_pretty(file, frames)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
    Ok(())
}
