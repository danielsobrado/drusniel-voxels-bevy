use serde::Serialize;
use thiserror::Error;

use super::config::QaTimingThreshold;
use super::summary::CheckpointSummary;

#[derive(Debug, Error)]
pub enum QaTimingError {
    #[error("missing required timing metric '{metric}'")]
    MissingRequiredMetric { metric: String },
}

#[derive(Clone, Debug, Serialize)]
pub struct TimingResult {
    pub id: String,
    pub area: String,
    pub field: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_ms: Option<f64>,
    pub max_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

pub fn evaluate_timing(
    checkpoint: &CheckpointSummary,
    threshold: &QaTimingThreshold,
    fail_on_threshold: bool,
) -> Result<TimingResult, QaTimingError> {
    let metric = format!("{}.{}", threshold.area, threshold.field);
    let Some(value) = metric_value(checkpoint, &threshold.area, &threshold.field) else {
        // Gate the missing-metric outcome on `fail_on_threshold` so report-only
        // mode never fails: optional metrics are always surfaced as non-failing,
        // and required metrics only error when thresholds are being enforced.
        if threshold.optional || !fail_on_threshold {
            return Ok(TimingResult {
                id: threshold.id.clone(),
                area: threshold.area.clone(),
                field: threshold.field.clone(),
                status: if threshold.optional {
                    "missing_optional"
                } else {
                    "missing_metric"
                }
                .to_string(),
                observed_ms: None,
                max_ms: threshold.max_ms,
                failure: None,
            });
        }
        return Err(QaTimingError::MissingRequiredMetric { metric });
    };

    let failed = fail_on_threshold && value > threshold.max_ms;
    Ok(TimingResult {
        id: threshold.id.clone(),
        area: threshold.area.clone(),
        field: threshold.field.clone(),
        status: if failed { "fail" } else { "pass" }.to_string(),
        observed_ms: Some(value),
        max_ms: threshold.max_ms,
        failure: failed.then(|| {
            format!(
                "{}.{} {value:.3}ms exceeded threshold {:.3}ms. Likely: a perf regression in that pass, or a noisy/cold run — re-run the bench and compare summary.json before treating it as real.",
                threshold.area, threshold.field, threshold.max_ms
            )
        }),
    })
}

fn metric_value(checkpoint: &CheckpointSummary, area: &str, field: &str) -> Option<f64> {
    if matches!(area, "__frame" | "__frame_total") {
        return match field {
            "median_ms" | "avg_ms" => Some(checkpoint.median_frame_ms),
            "p99_ms" => Some(checkpoint.p99_frame_ms),
            _ => None,
        };
    }

    let area = checkpoint.areas.get(area)?;
    match field {
        "median_ms" | "avg_ms" => Some(area.median_ms),
        "p99_ms" => Some(area.p99_ms),
        "calls_per_frame" => Some(area.calls_per_frame),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::diagnostics::qa::summary::AreaSummary;

    #[test]
    fn evaluates_frame_threshold() {
        let checkpoint = CheckpointSummary {
            name: "cp".into(),
            median_frame_ms: 10.0,
            p99_frame_ms: 20.0,
            areas: HashMap::new(),
            runs: Vec::new(),
        };
        let threshold = QaTimingThreshold {
            id: "frame_p99".into(),
            area: "__frame".into(),
            field: "p99_ms".into(),
            max_ms: 22.0,
            optional: false,
        };

        let result = evaluate_timing(&checkpoint, &threshold, true).unwrap();
        assert_eq!(result.status, "pass");
        assert_eq!(result.observed_ms, Some(20.0));
    }

    #[test]
    fn fails_missing_required_metric() {
        let checkpoint = CheckpointSummary {
            name: "cp".into(),
            median_frame_ms: 10.0,
            p99_frame_ms: 20.0,
            areas: HashMap::new(),
            runs: Vec::new(),
        };
        let threshold = QaTimingThreshold {
            id: "render".into(),
            area: "Render".into(),
            field: "p99_ms".into(),
            max_ms: 10.0,
            optional: false,
        };

        assert!(matches!(
            evaluate_timing(&checkpoint, &threshold, true),
            Err(QaTimingError::MissingRequiredMetric { .. })
        ));
    }

    #[test]
    fn missing_required_metric_does_not_fail_in_report_only_mode() {
        let checkpoint = CheckpointSummary {
            name: "cp".into(),
            median_frame_ms: 10.0,
            p99_frame_ms: 20.0,
            areas: HashMap::new(),
            runs: Vec::new(),
        };
        let threshold = QaTimingThreshold {
            id: "render".into(),
            area: "Render".into(),
            field: "p99_ms".into(),
            max_ms: 10.0,
            optional: false,
        };

        let result = evaluate_timing(&checkpoint, &threshold, false).unwrap();
        assert_eq!(result.status, "missing_metric");
        assert_eq!(result.observed_ms, None);
        assert!(result.failure.is_none());
    }

    #[test]
    fn evaluates_area_threshold() {
        let mut areas = HashMap::new();
        areas.insert(
            "Render".into(),
            AreaSummary {
                median_ms: 4.0,
                p99_ms: 9.0,
                calls_per_frame: 1.0,
            },
        );
        let checkpoint = CheckpointSummary {
            name: "cp".into(),
            median_frame_ms: 10.0,
            p99_frame_ms: 20.0,
            areas,
            runs: Vec::new(),
        };
        let threshold = QaTimingThreshold {
            id: "render".into(),
            area: "Render".into(),
            field: "p99_ms".into(),
            max_ms: 8.0,
            optional: false,
        };

        let result = evaluate_timing(&checkpoint, &threshold, true).unwrap();
        assert_eq!(result.status, "fail");
    }
}
