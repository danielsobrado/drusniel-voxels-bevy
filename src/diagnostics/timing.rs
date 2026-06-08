use bevy::diagnostic::{DiagnosticsStore, FrameCount, FrameTimeDiagnosticsPlugin};
use bevy::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{File, create_dir_all};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const AREA_TIMING_WINDOW_FRAMES: usize = 60;
const REQUIRED_TIMING_AREAS: &[&str] = &[
    "Render PrepareAssets CPU",
    "Render PrepareMeshes CPU",
    "Render Present Acquire CPU",
    "Render ManageViews CPU",
    "Render Queue CPU",
    "Render QueueMeshes CPU",
    "Render PhaseSort CPU",
    "Render Prepare CPU",
    "Render PrepareResources CPU",
    "Render PrepareBindGroups CPU",
    "Render Graph CPU",
    "Mesh Dirty",
    "LOD Update",
    "Octree Rebuild",
    "Visible Chunks",
    "Face Visibility",
    "Grass Collect",
    "Grass Animate",
    "Water Sim",
    "Water Upload",
    "Reflection Render",
    "Fog Submit",
    "God Rays",
    "Prop Spawn",
    "Prop Billboard",
    "Collider Build",
];

#[derive(Resource, Default)]
pub struct AreaTimingRecorder {
    pub enabled: bool,
    frame_index: u32,
    frame_initialized: bool,
    current_frame_total_us: Option<u64>,
    area_us: BTreeMap<String, u64>,
    area_calls: BTreeMap<String, u32>,
    counter_values: BTreeMap<String, f64>,
    counter_calls: BTreeMap<String, u32>,
    history: std::collections::VecDeque<AreaTimingFrameSample>,
}

#[derive(Clone, Copy, Default)]
struct AreaTimingSample {
    total_us: u64,
    calls: u32,
}

#[derive(Clone, Copy, Default)]
struct AreaCounterSample {
    total: f64,
    calls: u32,
}

#[derive(Clone, Default)]
struct AreaTimingFrameSample {
    areas: BTreeMap<String, AreaTimingSample>,
    counters: BTreeMap<String, AreaCounterSample>,
    frame_total_us: Option<u64>,
}

pub struct AreaTimingSummary {
    pub area: String,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub p99_ms: f64,
    pub calls_per_frame: f64,
    pub unit: &'static str,
}

impl AreaTimingRecorder {
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled == enabled {
            return;
        }
        self.enabled = enabled;
        self.frame_initialized = false;
        self.current_frame_total_us = None;
        self.area_us.clear();
        self.area_calls.clear();
        self.counter_values.clear();
        self.counter_calls.clear();
        self.history.clear();
    }

    pub fn reset_frame(&mut self, frame: u32) {
        self.reset_frame_with_total(frame, None);
    }

    pub fn reset_frame_with_total(&mut self, frame: u32, frame_total_ms: Option<f64>) {
        if self.enabled && self.frame_initialized {
            self.push_current_frame();
        }
        self.frame_index = frame;
        self.frame_initialized = true;
        self.current_frame_total_us = frame_total_ms.map(|ms| (ms.max(0.0) * 1000.0) as u64);
        self.area_us.clear();
        self.area_calls.clear();
        self.counter_values.clear();
        self.counter_calls.clear();
    }

    pub fn record(&mut self, frame: u32, area: &'static str, duration_us: u64) {
        self.record_area(frame, area, duration_us);
    }

    pub fn record_area(&mut self, frame: u32, area: impl Into<String>, duration_us: u64) {
        if !self.enabled {
            return;
        }
        if !self.frame_initialized {
            self.frame_index = frame;
            self.frame_initialized = true;
        } else if self.frame_index != frame {
            self.reset_frame(frame);
        }
        let area = area.into();
        *self.area_us.entry(area.clone()).or_insert(0) += duration_us;
        *self.area_calls.entry(area).or_insert(0) += 1;
    }

    pub fn record_count(&mut self, frame: u32, area: impl Into<String>, value: f64) {
        if !self.enabled || !value.is_finite() {
            return;
        }
        if !self.frame_initialized {
            self.frame_index = frame;
            self.frame_initialized = true;
        } else if self.frame_index != frame {
            self.reset_frame(frame);
        }
        let area = format!("Counter {}", area.into());
        *self.counter_values.entry(area.clone()).or_insert(0.0) += value.max(0.0);
        *self.counter_calls.entry(area).or_insert(0) += 1;
    }

    pub fn areas(&self) -> &BTreeMap<String, u64> {
        &self.area_us
    }

    pub fn rolling_summaries(&self) -> Vec<AreaTimingSummary> {
        let frame_count = self.history.len();
        if frame_count == 0 {
            return Vec::new();
        }

        let mut areas = std::collections::BTreeSet::new();
        areas.extend(REQUIRED_TIMING_AREAS.iter().map(|area| (*area).to_string()));
        for frame in &self.history {
            areas.extend(frame.areas.keys().cloned());
        }

        let mut summaries = Vec::with_capacity(areas.len());
        for area in areas {
            let mut total_us = 0u64;
            let mut total_calls = 0u64;
            let mut samples = Vec::with_capacity(frame_count);

            for frame in &self.history {
                let sample = frame.areas.get(&area).copied().unwrap_or_default();
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
                unit: "ms",
            });
        }

        let mut counters = std::collections::BTreeSet::new();
        for frame in &self.history {
            counters.extend(frame.counters.keys().cloned());
        }
        for counter in counters {
            let mut total = 0.0;
            let mut total_calls = 0u64;
            let mut samples = Vec::with_capacity(frame_count);

            for frame in &self.history {
                let sample = frame.counters.get(&counter).copied().unwrap_or_default();
                total += sample.total;
                total_calls += sample.calls as u64;
                samples.push(sample.total);
            }

            samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let max_value = samples.last().copied().unwrap_or(0.0);
            let p99_value = percentile_f64(&samples, 0.99);
            summaries.push(AreaTimingSummary {
                area: counter,
                avg_ms: total / frame_count as f64,
                max_ms: max_value,
                p99_ms: p99_value,
                calls_per_frame: total_calls as f64 / frame_count as f64,
                unit: "count",
            });
        }

        summaries.sort_by(|a, b| {
            a.unit
                .cmp(b.unit)
                .reverse()
                .then_with(|| {
                    b.avg_ms
                        .partial_cmp(&a.avg_ms)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| a.area.cmp(&b.area))
        });
        summaries
    }

    pub fn frame_total_summary(&self) -> Option<AreaTimingSummary> {
        let samples: Vec<u64> = self
            .history
            .iter()
            .filter_map(|frame| frame.frame_total_us)
            .collect();
        summarize_us_samples("__frame_total", samples, 1.0)
    }

    pub fn tracked_area_total_summary(&self) -> Option<AreaTimingSummary> {
        let samples: Vec<u64> = self
            .history
            .iter()
            .map(|frame| frame.areas.values().map(|sample| sample.total_us).sum())
            .collect();
        summarize_us_samples("__tracked_area_total", samples, 1.0)
    }

    pub fn untracked_wall_time_summary(&self) -> Option<AreaTimingSummary> {
        let samples: Vec<u64> = self
            .history
            .iter()
            .filter_map(|frame| {
                let frame_total = frame.frame_total_us?;
                let tracked_total: u64 = frame.areas.values().map(|sample| sample.total_us).sum();
                Some(frame_total.saturating_sub(tracked_total))
            })
            .collect();
        summarize_us_samples("__untracked_wall_time", samples, 1.0)
    }

    pub fn latest_counter_value(&self, area: &str) -> Option<f64> {
        let counter = format!("Counter {area}");
        if let Some(value) = self.counter_values.get(&counter) {
            return Some(*value);
        }
        self.history
            .iter()
            .rev()
            .find_map(|frame| frame.counters.get(&counter).map(|sample| sample.total))
    }

    pub fn clear_window(&mut self) {
        self.frame_initialized = false;
        self.current_frame_total_us = None;
        self.area_us.clear();
        self.area_calls.clear();
        self.counter_values.clear();
        self.counter_calls.clear();
        self.history.clear();
    }

    fn push_current_frame(&mut self) {
        let mut areas = BTreeMap::new();
        for (area, total_us) in &self.area_us {
            areas.insert(
                area.clone(),
                AreaTimingSample {
                    total_us: *total_us,
                    calls: self.area_calls.get(area).copied().unwrap_or(0),
                },
            );
        }
        let mut counters = BTreeMap::new();
        for (area, total) in &self.counter_values {
            counters.insert(
                area.clone(),
                AreaCounterSample {
                    total: *total,
                    calls: self.counter_calls.get(area).copied().unwrap_or(0),
                },
            );
        }
        self.history.push_back(AreaTimingFrameSample {
            areas,
            counters,
            frame_total_us: self.current_frame_total_us,
        });
        while self.history.len() > AREA_TIMING_WINDOW_FRAMES {
            self.history.pop_front();
        }
    }
}

fn summarize_us_samples(
    area: impl Into<String>,
    mut samples: Vec<u64>,
    calls_per_frame: f64,
) -> Option<AreaTimingSummary> {
    if samples.is_empty() {
        return None;
    }

    let total_us = samples.iter().sum::<u64>();
    samples.sort_unstable();
    let max_us = samples.last().copied().unwrap_or(0);
    let p99_us = percentile_us(&samples, 0.99);
    Some(AreaTimingSummary {
        area: area.into(),
        avg_ms: total_us as f64 / samples.len() as f64 / 1000.0,
        max_ms: max_us as f64 / 1000.0,
        p99_ms: p99_us as f64 / 1000.0,
        calls_per_frame,
        unit: "ms",
    })
}

fn percentile_us(sorted_samples: &[u64], percentile: f64) -> u64 {
    if sorted_samples.is_empty() {
        return 0;
    }
    let rank = ((sorted_samples.len() as f64) * percentile).ceil() as usize;
    sorted_samples[rank.saturating_sub(1).min(sorted_samples.len() - 1)]
}

fn percentile_f64(sorted_samples: &[f64], percentile: f64) -> f64 {
    if sorted_samples.is_empty() {
        return 0.0;
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

pub fn reset_area_timing_frame(
    mut recorder: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    real_time: Res<Time<Real>>,
    diagnostics: Res<DiagnosticsStore>,
) {
    if recorder.enabled {
        let real_delta_ms = real_time.delta_secs_f64() * 1000.0;
        let frame_total_ms = if real_delta_ms.is_finite() && real_delta_ms > 0.0 {
            Some(real_delta_ms)
        } else {
            diagnostics
                .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
                .and_then(|diagnostic| diagnostic.value())
        };
        recorder.reset_frame_with_total(frame.0, frame_total_ms);
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
    let timestamp = utc_timestamp_for_filename(SystemTime::now());
    path.push(format!("frame-{}.csv", timestamp));
    write_area_timing_csv(recorder, &path)
}

pub fn write_area_timing_csv(
    recorder: &AreaTimingRecorder,
    path: impl AsRef<Path>,
) -> std::io::Result<PathBuf> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }
    let mut file = File::create(&path)?;
    writeln!(file, "area,avg_ms,max_ms,p99_ms,calls_per_frame")?;
    let frame_total = recorder.frame_total_summary().unwrap_or(AreaTimingSummary {
        area: "__frame_total".to_string(),
        avg_ms: 0.0,
        max_ms: 0.0,
        p99_ms: 0.0,
        calls_per_frame: 1.0,
        unit: "ms",
    });
    write_csv_row(&mut file, &frame_total)?;
    if let Some(tracked_total) = recorder.tracked_area_total_summary() {
        write_csv_row(&mut file, &tracked_total)?;
    }
    if let Some(untracked_wall) = recorder.untracked_wall_time_summary() {
        write_csv_row(&mut file, &untracked_wall)?;
    }
    for summary in recorder.rolling_summaries() {
        write_csv_row(&mut file, &summary)?;
    }
    Ok(path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
}

fn write_csv_row(file: &mut File, summary: &AreaTimingSummary) -> std::io::Result<()> {
    writeln!(
        file,
        "{},{:.3},{:.3},{:.3},{:.3}",
        summary.area, summary.avg_ms, summary.max_ms, summary.p99_ms, summary.calls_per_frame,
    )
}

fn utc_timestamp_for_filename(time: SystemTime) -> String {
    let secs = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let second_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}-{minute:02}-{second:02}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
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
