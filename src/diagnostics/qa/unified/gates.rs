use serde::Serialize;

use super::schema::{CounterGate, CounterOperator, Enforcement, InformationalMetric, TimingGate};
use super::summary::UnifiedCheckpoint;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GateStatus {
    Pass,
    Fail,
    AdvisoryExceeded,
    NotApplicable,
}

impl GateStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::AdvisoryExceeded => "ADVISORY_EXCEEDED",
            Self::NotApplicable => "NOT_APPLICABLE",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TimingGateResult {
    pub id: String,
    pub metric: String,
    pub status: GateStatus,
    pub observed: Option<f64>,
    pub max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CounterGateResult {
    pub id: String,
    pub key: String,
    pub status: GateStatus,
    pub observed: Option<f64>,
    pub expected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InformationalStatus {
    Value,
    NotApplicable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct InformationalMetricResult {
    pub id: String,
    pub key: String,
    pub status: InformationalStatus,
    pub observed: Option<f64>,
}

pub fn evaluate_timing_gates(
    checkpoint: &UnifiedCheckpoint,
    gates: &[TimingGate],
) -> Vec<TimingGateResult> {
    gates
        .iter()
        .map(|gate| {
            let observed = checkpoint.resolve_metric(&gate.metric);
            let Some(observed) = observed else {
                return if gate.required {
                    TimingGateResult {
                        id: gate.id.clone(),
                        metric: gate.metric.clone(),
                        status: GateStatus::Fail,
                        observed: None,
                        max: gate.max,
                        failure: Some(format!(
                            "missing required timing metric {}",
                            gate.metric
                        )),
                    }
                } else {
                    TimingGateResult {
                        id: gate.id.clone(),
                        metric: gate.metric.clone(),
                        status: GateStatus::NotApplicable,
                        observed: None,
                        max: gate.max,
                        failure: None,
                    }
                };
            };
            if observed <= gate.max {
                TimingGateResult {
                    id: gate.id.clone(),
                    metric: gate.metric.clone(),
                    status: GateStatus::Pass,
                    observed: Some(observed),
                    max: gate.max,
                    failure: None,
                }
            } else if gate.enforcement == Enforcement::Advisory {
                TimingGateResult {
                    id: gate.id.clone(),
                    metric: gate.metric.clone(),
                    status: GateStatus::AdvisoryExceeded,
                    observed: Some(observed),
                    max: gate.max,
                    failure: None,
                }
            } else {
                TimingGateResult {
                    id: gate.id.clone(),
                    metric: gate.metric.clone(),
                    status: GateStatus::Fail,
                    observed: Some(observed),
                    max: gate.max,
                    failure: Some(format!("{} {} > {}", gate.metric, observed, gate.max)),
                }
            }
        })
        .collect()
}

pub fn evaluate_counter_gates(
    checkpoint: &UnifiedCheckpoint,
    gates: &[CounterGate],
) -> Vec<CounterGateResult> {
    gates
        .iter()
        .map(|gate| {
            let expected = expectation(gate);
            let observed = checkpoint.resolve_metric(&gate.key);
            let Some(observed) = observed else {
                return if gate.required {
                    CounterGateResult {
                        id: gate.id.clone(),
                        key: gate.key.clone(),
                        status: GateStatus::Fail,
                        observed: None,
                        expected,
                        failure: Some(format!("missing required counter {}", gate.key)),
                    }
                } else {
                    CounterGateResult {
                        id: gate.id.clone(),
                        key: gate.key.clone(),
                        status: GateStatus::NotApplicable,
                        observed: None,
                        expected,
                        failure: None,
                    }
                };
            };
            if counter_matches(gate, observed) {
                CounterGateResult {
                    id: gate.id.clone(),
                    key: gate.key.clone(),
                    status: GateStatus::Pass,
                    observed: Some(observed),
                    expected,
                    failure: None,
                }
            } else {
                CounterGateResult {
                    id: gate.id.clone(),
                    key: gate.key.clone(),
                    status: GateStatus::Fail,
                    observed: Some(observed),
                    failure: Some(format!(
                        "{}={} expected {}",
                        gate.key, observed, expected
                    )),
                    expected,
                }
            }
        })
        .collect()
}

pub fn read_informational_metrics(
    checkpoint: &UnifiedCheckpoint,
    metrics: &[InformationalMetric],
) -> Vec<InformationalMetricResult> {
    metrics
        .iter()
        .map(|metric| {
            let observed = checkpoint.resolve_metric(&metric.key);
            InformationalMetricResult {
                id: metric.id.clone(),
                key: metric.key.clone(),
                status: if observed.is_some() {
                    InformationalStatus::Value
                } else {
                    InformationalStatus::NotApplicable
                },
                observed,
            }
        })
        .collect()
}

fn counter_matches(gate: &CounterGate, observed: f64) -> bool {
    match gate.operator {
        CounterOperator::Equals => gate.value == Some(observed),
        CounterOperator::Min => gate.value.is_some_and(|value| observed >= value),
        CounterOperator::Max => gate.value.is_some_and(|value| observed <= value),
        CounterOperator::Between => gate
            .range
            .is_some_and(|[minimum, maximum]| observed >= minimum && observed <= maximum),
    }
}

fn expectation(gate: &CounterGate) -> String {
    match gate.operator {
        CounterOperator::Between => gate.range.map_or_else(
            || "between <invalid>".to_string(),
            |[minimum, maximum]| format!("between {minimum} and {maximum}"),
        ),
        operator => format!("{} {}", operator.as_str(), gate.value.unwrap_or_default()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    fn checkpoint() -> UnifiedCheckpoint {
        UnifiedCheckpoint {
            name: "main".into(),
            p95_frame_ms: Some(12.0),
            areas: BTreeMap::from([
                ("flags".into(), json!({ "readback": 1 })),
                ("counters".into(), json!({ "overflow": 0 })),
            ]),
            ..Default::default()
        }
    }

    #[test]
    fn missing_and_threshold_timing_fail() {
        let results = evaluate_timing_gates(
            &checkpoint(),
            &[
                TimingGate {
                    id: "frame".into(),
                    metric: "frame_ms_p95".into(),
                    max: 11.1,
                    enforcement: Enforcement::Required,
                    required: true,
                },
                TimingGate {
                    id: "missing".into(),
                    metric: "areas.gpu.missing".into(),
                    max: 1.0,
                    enforcement: Enforcement::Required,
                    required: true,
                },
            ],
        );
        assert_eq!(results[0].status, GateStatus::Fail);
        assert_eq!(results[1].status, GateStatus::Fail);
    }

    #[test]
    fn optional_counter_is_not_applicable_and_readback_fails() {
        let results = evaluate_counter_gates(
            &checkpoint(),
            &[
                CounterGate {
                    id: "optional".into(),
                    key: "areas.optional.value".into(),
                    operator: CounterOperator::Equals,
                    value: Some(0.0),
                    range: None,
                    required: false,
                },
                CounterGate {
                    id: "readback".into(),
                    key: "areas.flags.readback".into(),
                    operator: CounterOperator::Equals,
                    value: Some(0.0),
                    range: None,
                    required: true,
                },
            ],
        );
        assert_eq!(results[0].status, GateStatus::NotApplicable);
        assert_eq!(results[1].status, GateStatus::Fail);
    }
}
