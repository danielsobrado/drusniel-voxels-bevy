use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{File, create_dir_all};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const AREA_TIMING_WINDOW_FRAMES: usize = 60;

#[derive(Resource, Default)]
pub struct AreaTimingRecorder {
    pub enabled: bool,
    frame_index: u32,
    frame_initialized: bool,
    area_us: BTreeMap<&'static str, u64>,
    area_calls: BTreeMap<&'static str, u32>,
    history: std::collections::VecDeque<AreaTimingFrameSample>,
}

#[derive(Clone, Copy, Default)]
struct AreaTimingSample {
    total_us: u64,
    calls: u32,
}

#[derive(Clone, Default)]
struct AreaTimingFrameSample {
    areas: BTreeMap<&'static str, AreaTimingSample>,
}

pub struct AreaTimingSummary {
    pub area: &'static str,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub p99_ms: f64,
    pub calls_per_frame: f64,
}

impl AreaTimingRecorder {
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled == enabled {
            return;
        }
        self.enabled = enabled;
        self.frame_initialized = false;
        self.area_us.clear();
        self.area_calls.clear();
        self.history.clear();
    }

    pub fn reset_frame(&mut self, frame: u32) {
        if self.enabled && self.frame_initialized {
            self.push_current_frame();
        }
        self.frame_index = frame;
        self.frame_initialized = true;
        self.area_us.clear();
        self.area_calls.clear();
    }

    pub fn record(&mut self, frame: u32, area: &'static str, duration_us: u64) {
        if !self.enabled {
            return;
        }
        if !self.frame_initialized {
            self.frame_index = frame;
            self.frame_initialized = true;
        } else if self.frame_index != frame {
            self.reset_frame(frame);
        }
        *self.area_us.entry(area).or_insert(0) += duration_us;
        *self.area_calls.entry(area).or_insert(0) += 1;
    }

    pub fn areas(&self) -> &BTreeMap<&'static str, u64> {
        &self.area_us
    }

    pub fn rolling_summaries(&self) -> Vec<AreaTimingSummary> {
        let frame_count = self.history.len();
        if frame_count == 0 {
            return Vec::new();
        }

        let mut areas = std::collections::BTreeSet::new();
        for frame in &self.history {
            areas.extend(frame.areas.keys().copied());
        }

        let mut summaries = Vec::with_capacity(areas.len());
        for area in areas {
            let mut total_us = 0u64;
            let mut total_calls = 0u64;
            let mut samples = Vec::with_capacity(frame_count);

            for frame in &self.history {
                let sample = frame.areas.get(area).copied().unwrap_or_default();
                total_us += sample.total_us;
                total_calls += sample.calls as u64;
                samples.push(sample.total_us);
            }

            samples.sort_unstable();
            let max_us = samples.last().copied().unwrap_or(0);
            let p99_us = percentile_us(&samples, 0.99);
            summaries.push(AreaTimingSummary {
                area,
                avg_ms: total_us as f64 / frame_count as f64 / 1000.0,
                max_ms: max_us as f64 / 1000.0,
                p99_ms: p99_us as f64 / 1000.0,
                calls_per_frame: total_calls as f64 / frame_count as f64,
            });
        }

        summaries.sort_by(|a, b| {
            b.avg_ms
                .partial_cmp(&a.avg_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.area.cmp(b.area))
        });
        summaries
    }

    fn push_current_frame(&mut self) {
        let mut areas = BTreeMap::new();
        for (area, total_us) in &self.area_us {
            areas.insert(
                *area,
                AreaTimingSample {
                    total_us: *total_us,
                    calls: self.area_calls.get(area).copied().unwrap_or(0),
                },
            );
        }
        self.history.push_back(AreaTimingFrameSample { areas });
        while self.history.len() > AREA_TIMING_WINDOW_FRAMES {
            self.history.pop_front();
        }
    }
}

fn percentile_us(sorted_samples: &[u64], percentile: f64) -> u64 {
    if sorted_samples.is_empty() {
        return 0;
    }
    let rank = ((sorted_samples.len() as f64) * percentile).ceil() as usize;
    sorted_samples[rank.saturating_sub(1).min(sorted_samples.len() - 1)]
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

pub fn reset_area_timing_frame(mut recorder: ResMut<AreaTimingRecorder>, frame: Res<FrameCount>) {
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

pub fn dump_area_timing_csv(recorder: &AreaTimingRecorder) -> std::io::Result<PathBuf> {
    let mut path = PathBuf::from("perf-dumps");
    create_dir_all(&path)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    path.push(format!("frame-{}.csv", timestamp));

    let mut file = File::create(&path)?;
    writeln!(file, "area,avg_ms,max_ms,p99_ms,calls_per_frame")?;
    for summary in recorder.rolling_summaries() {
        writeln!(
            file,
            "{},{:.3},{:.3},{:.3},{:.3}",
            summary.area, summary.avg_ms, summary.max_ms, summary.p99_ms, summary.calls_per_frame,
        )?;
    }
    Ok(path)
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
