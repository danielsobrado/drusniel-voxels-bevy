//! Bench-guard helpers for the  CLOD shadow runtime path.
//!
//! The normal bench output already records stable `Clod Shadow ...` metrics.
//! This module gives the regression guard a small, deterministic evaluator for
//! those metrics so the proxy path can fail loudly when it stops saving shadow
//! triangles or starts dropping required visual/proxy mappings.

use std::collections::BTreeMap;

pub const METRIC_RUNTIME_MODE_CODE: &str = "Clod Shadow Runtime Mode Code";
pub const METRIC_LOADED_PAGES: &str = "Clod Shadow Loaded Pages";
pub const METRIC_VISUAL_CASTER_PAGES: &str = "Clod Shadow Visual Caster Pages";
pub const METRIC_PROXY_CASTER_PAGES: &str = "Clod Shadow Proxy Caster Pages";
pub const METRIC_NO_CAST_PAGES: &str = "Clod Shadow No Cast Pages";
pub const METRIC_MISSING_VISUAL_ENTITIES: &str = "Clod Shadow Missing Visual Entities";
pub const METRIC_MISSING_PROXY_MESHES: &str = "Clod Shadow Missing Proxy Meshes";
pub const METRIC_VISUAL_TRIANGLES: &str = "Clod Shadow Visual Triangles";
pub const METRIC_RUNTIME_TRIANGLES: &str = "Clod Shadow Runtime Triangles";
pub const METRIC_SAVED_TRIANGLES: &str = "Clod Shadow Saved Triangles";
pub const METRIC_SAVED_PERCENT: &str = "Clod Shadow Saved Percent";

pub const MODE_DISABLED: u32 = 0;
pub const MODE_PROXY: u32 = 1;
pub const MODE_VISUAL_ONLY: u32 = 2;
pub const MODE_NO_CAST_ONLY: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClodShadowGuardStatus {
    Pass,
    Warn,
    Fail,
}

impl ClodShadowGuardStatus {
    pub fn combine(self, other: Self) -> Self {
        match (self, other) {
            (Self::Fail, _) | (_, Self::Fail) => Self::Fail,
            (Self::Warn, _) | (_, Self::Warn) => Self::Warn,
            _ => Self::Pass,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClodShadowBenchGuardThresholds {
    /// Proxy mode must save at least this percentage of visual shadow triangles.
    pub proxy_min_saved_percent: f64,
    /// Proxy mode must exercise at least this many proxy pages.
    pub proxy_min_proxy_pages: f64,
    /// Missing visual terrain mappings are hard failures above this value.
    pub proxy_max_missing_visual_entities: f64,
    /// Missing proxy meshes are hard failures above this value.
    pub proxy_max_missing_proxy_meshes: f64,
    /// Visual-only mode should not claim meaningful triangle savings.
    pub visual_max_saved_percent: f64,
    /// Visual-only mode should not spawn proxy casters.
    pub visual_max_proxy_pages: f64,
    /// No-cast mode should have no CLOD terrain caster pages.
    pub nocast_max_caster_pages: f64,
    /// Disabled mode should not leave an active CLOD shadow snapshot loaded.
    pub disabled_max_loaded_pages: f64,
}

impl Default for ClodShadowBenchGuardThresholds {
    fn default() -> Self {
        Self {
            proxy_min_saved_percent: 45.0,
            proxy_min_proxy_pages: 1.0,
            proxy_max_missing_visual_entities: 0.0,
            proxy_max_missing_proxy_meshes: 0.0,
            visual_max_saved_percent: 5.0,
            visual_max_proxy_pages: 0.0,
            nocast_max_caster_pages: 0.0,
            disabled_max_loaded_pages: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClodShadowGuardCheck {
    pub name: String,
    pub metric: String,
    pub observed: Option<f64>,
    pub expectation: String,
    pub status: ClodShadowGuardStatus,
}

impl ClodShadowGuardCheck {
    pub fn pass(
        name: impl Into<String>,
        metric: impl Into<String>,
        observed: f64,
        expectation: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            metric: metric.into(),
            observed: Some(observed),
            expectation: expectation.into(),
            status: ClodShadowGuardStatus::Pass,
        }
    }

    pub fn fail(
        name: impl Into<String>,
        metric: impl Into<String>,
        observed: Option<f64>,
        expectation: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            metric: metric.into(),
            observed,
            expectation: expectation.into(),
            status: ClodShadowGuardStatus::Fail,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClodShadowBenchGuardReport {
    pub mode_code: Option<u32>,
    pub status: ClodShadowGuardStatus,
    pub checks: Vec<ClodShadowGuardCheck>,
}

impl ClodShadowBenchGuardReport {
    pub fn is_pass(&self) -> bool {
        self.status == ClodShadowGuardStatus::Pass
    }

    pub fn failure_messages(&self) -> Vec<String> {
        self.checks
            .iter()
            .filter(|check| check.status == ClodShadowGuardStatus::Fail)
            .map(|check| {
                let observed = check
                    .observed
                    .map(|value| format!("{value:.4}"))
                    .unwrap_or_else(|| "missing".to_owned());
                format!(
                    "{}: {} observed {}, expected {}",
                    check.name, check.metric, observed, check.expectation
                )
            })
            .collect()
    }
}

pub fn evaluate_clod_shadow_bench_metrics(
    metrics: &BTreeMap<String, f64>,
    thresholds: &ClodShadowBenchGuardThresholds,
) -> ClodShadowBenchGuardReport {
    let mut checks = Vec::new();
    let Some(mode_code_value) = metric(metrics, METRIC_RUNTIME_MODE_CODE) else {
        checks.push(ClodShadowGuardCheck::fail(
            "runtime mode present",
            METRIC_RUNTIME_MODE_CODE,
            None,
            "a numeric mode code emitted by PR 0011",
        ));
        return report(None, checks);
    };

    let mode_code = mode_code_value.round() as u32;
    checks.push(ClodShadowGuardCheck::pass(
        "runtime mode present",
        METRIC_RUNTIME_MODE_CODE,
        mode_code_value,
        "present",
    ));

    match mode_code {
        MODE_PROXY => evaluate_proxy(metrics, thresholds, &mut checks),
        MODE_VISUAL_ONLY => evaluate_visual_only(metrics, thresholds, &mut checks),
        MODE_NO_CAST_ONLY => evaluate_no_cast(metrics, thresholds, &mut checks),
        MODE_DISABLED => evaluate_disabled(metrics, thresholds, &mut checks),
        _ => checks.push(ClodShadowGuardCheck::fail(
            "runtime mode known",
            METRIC_RUNTIME_MODE_CODE,
            Some(mode_code_value),
            "0 disabled, 1 proxy, 2 visual-only, or 3 no-cast-only",
        )),
    }

    report(Some(mode_code), checks)
}

fn evaluate_proxy(
    metrics: &BTreeMap<String, f64>,
    thresholds: &ClodShadowBenchGuardThresholds,
    checks: &mut Vec<ClodShadowGuardCheck>,
) {
    check_at_least(
        checks,
        metrics,
        "proxy saves triangles",
        METRIC_SAVED_PERCENT,
        thresholds.proxy_min_saved_percent,
    );
    check_at_least(
        checks,
        metrics,
        "proxy pages present",
        METRIC_PROXY_CASTER_PAGES,
        thresholds.proxy_min_proxy_pages,
    );
    check_at_most(
        checks,
        metrics,
        "visual mappings complete",
        METRIC_MISSING_VISUAL_ENTITIES,
        thresholds.proxy_max_missing_visual_entities,
    );
    check_at_most(
        checks,
        metrics,
        "proxy meshes complete",
        METRIC_MISSING_PROXY_MESHES,
        thresholds.proxy_max_missing_proxy_meshes,
    );
    check_less_than(
        checks,
        metrics,
        "runtime triangles below visual triangles",
        METRIC_RUNTIME_TRIANGLES,
        METRIC_VISUAL_TRIANGLES,
    );
    check_at_least(
        checks,
        metrics,
        "saved triangles positive",
        METRIC_SAVED_TRIANGLES,
        1.0,
    );
}

fn evaluate_visual_only(
    metrics: &BTreeMap<String, f64>,
    thresholds: &ClodShadowBenchGuardThresholds,
    checks: &mut Vec<ClodShadowGuardCheck>,
) {
    check_at_most(
        checks,
        metrics,
        "visual mode has no proxy pages",
        METRIC_PROXY_CASTER_PAGES,
        thresholds.visual_max_proxy_pages,
    );
    check_at_most(
        checks,
        metrics,
        "visual mode does not claim proxy savings",
        METRIC_SAVED_PERCENT,
        thresholds.visual_max_saved_percent,
    );
    check_at_least(
        checks,
        metrics,
        "visual casters present",
        METRIC_VISUAL_CASTER_PAGES,
        1.0,
    );
}

fn evaluate_no_cast(
    metrics: &BTreeMap<String, f64>,
    thresholds: &ClodShadowBenchGuardThresholds,
    checks: &mut Vec<ClodShadowGuardCheck>,
) {
    let caster_pages = metric(metrics, METRIC_VISUAL_CASTER_PAGES)
        .zip(metric(metrics, METRIC_PROXY_CASTER_PAGES))
        .map(|(visual, proxy)| visual + proxy);
    let status = match caster_pages {
        Some(value) if value <= thresholds.nocast_max_caster_pages => ClodShadowGuardStatus::Pass,
        _ => ClodShadowGuardStatus::Fail,
    };
    checks.push(ClodShadowGuardCheck {
        name: "no-cast has no caster pages".to_owned(),
        metric: format!("{METRIC_VISUAL_CASTER_PAGES} + {METRIC_PROXY_CASTER_PAGES}"),
        observed: caster_pages,
        expectation: format!("<= {:.4}", thresholds.nocast_max_caster_pages),
        status,
    });
    check_at_most(
        checks,
        metrics,
        "no-cast runtime triangles",
        METRIC_RUNTIME_TRIANGLES,
        0.0,
    );
}

fn evaluate_disabled(
    metrics: &BTreeMap<String, f64>,
    thresholds: &ClodShadowBenchGuardThresholds,
    checks: &mut Vec<ClodShadowGuardCheck>,
) {
    check_at_most(
        checks,
        metrics,
        "disabled mode keeps snapshot inactive",
        METRIC_LOADED_PAGES,
        thresholds.disabled_max_loaded_pages,
    );
}

fn check_at_least(
    checks: &mut Vec<ClodShadowGuardCheck>,
    metrics: &BTreeMap<String, f64>,
    name: &'static str,
    metric_name: &'static str,
    min_value: f64,
) {
    let observed = metric(metrics, metric_name);
    let status = match observed {
        Some(value) if value >= min_value => ClodShadowGuardStatus::Pass,
        _ => ClodShadowGuardStatus::Fail,
    };
    checks.push(ClodShadowGuardCheck {
        name: name.to_owned(),
        metric: metric_name.to_owned(),
        observed,
        expectation: format!(">= {min_value:.4}"),
        status,
    });
}

fn check_at_most(
    checks: &mut Vec<ClodShadowGuardCheck>,
    metrics: &BTreeMap<String, f64>,
    name: &'static str,
    metric_name: &'static str,
    max_value: f64,
) {
    let observed = metric(metrics, metric_name);
    let status = match observed {
        Some(value) if value <= max_value => ClodShadowGuardStatus::Pass,
        _ => ClodShadowGuardStatus::Fail,
    };
    checks.push(ClodShadowGuardCheck {
        name: name.to_owned(),
        metric: metric_name.to_owned(),
        observed,
        expectation: format!("<= {max_value:.4}"),
        status,
    });
}

fn check_less_than(
    checks: &mut Vec<ClodShadowGuardCheck>,
    metrics: &BTreeMap<String, f64>,
    name: &'static str,
    lhs_metric: &'static str,
    rhs_metric: &'static str,
) {
    let lhs = metric(metrics, lhs_metric);
    let rhs = metric(metrics, rhs_metric);
    let status = match lhs.zip(rhs) {
        Some((lhs, rhs)) if lhs < rhs => ClodShadowGuardStatus::Pass,
        _ => ClodShadowGuardStatus::Fail,
    };
    checks.push(ClodShadowGuardCheck {
        name: name.to_owned(),
        metric: format!("{lhs_metric} < {rhs_metric}"),
        observed: lhs,
        expectation: rhs
            .map(|value| format!("< {value:.4}"))
            .unwrap_or_else(|| format!("{rhs_metric} present")),
        status,
    });
}

fn metric(metrics: &BTreeMap<String, f64>, name: &str) -> Option<f64> {
    metrics.get(name).copied().filter(|value| value.is_finite())
}

fn report(mode_code: Option<u32>, checks: Vec<ClodShadowGuardCheck>) -> ClodShadowBenchGuardReport {
    let status = checks
        .iter()
        .fold(ClodShadowGuardStatus::Pass, |status, check| {
            status.combine(check.status)
        });
    ClodShadowBenchGuardReport {
        mode_code,
        status,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy_metrics() -> BTreeMap<String, f64> {
        BTreeMap::from([
            (METRIC_RUNTIME_MODE_CODE.to_owned(), MODE_PROXY as f64),
            (METRIC_LOADED_PAGES.to_owned(), 120.0),
            (METRIC_VISUAL_CASTER_PAGES.to_owned(), 24.0),
            (METRIC_PROXY_CASTER_PAGES.to_owned(), 38.0),
            (METRIC_NO_CAST_PAGES.to_owned(), 58.0),
            (METRIC_MISSING_VISUAL_ENTITIES.to_owned(), 0.0),
            (METRIC_MISSING_PROXY_MESHES.to_owned(), 0.0),
            (METRIC_VISUAL_TRIANGLES.to_owned(), 910_000.0),
            (METRIC_RUNTIME_TRIANGLES.to_owned(), 246_000.0),
            (METRIC_SAVED_TRIANGLES.to_owned(), 664_000.0),
            (METRIC_SAVED_PERCENT.to_owned(), 73.0),
        ])
    }

    #[test]
    fn proxy_metrics_pass_default_thresholds() {
        let report = evaluate_clod_shadow_bench_metrics(
            &proxy_metrics(),
            &ClodShadowBenchGuardThresholds::default(),
        );
        assert!(report.is_pass(), "{:?}", report.failure_messages());
    }

    #[test]
    fn proxy_metrics_fail_when_savings_disappear() {
        let mut metrics = proxy_metrics();
        metrics.insert(METRIC_SAVED_PERCENT.to_owned(), 3.0);
        metrics.insert(METRIC_RUNTIME_TRIANGLES.to_owned(), 900_000.0);
        let report = evaluate_clod_shadow_bench_metrics(
            &metrics,
            &ClodShadowBenchGuardThresholds::default(),
        );
        assert_eq!(report.status, ClodShadowGuardStatus::Fail);
        assert!(
            report
                .failure_messages()
                .iter()
                .any(|message| message.contains("proxy saves triangles"))
        );
    }

    #[test]
    fn visual_only_mode_rejects_proxy_pages() {
        let metrics = BTreeMap::from([
            (METRIC_RUNTIME_MODE_CODE.to_owned(), MODE_VISUAL_ONLY as f64),
            (METRIC_VISUAL_CASTER_PAGES.to_owned(), 120.0),
            (METRIC_PROXY_CASTER_PAGES.to_owned(), 4.0),
            (METRIC_SAVED_PERCENT.to_owned(), 0.0),
        ]);
        let report = evaluate_clod_shadow_bench_metrics(
            &metrics,
            &ClodShadowBenchGuardThresholds::default(),
        );
        assert_eq!(report.status, ClodShadowGuardStatus::Fail);
    }

    #[test]
    fn nocast_mode_requires_zero_casters() {
        let metrics = BTreeMap::from([
            (
                METRIC_RUNTIME_MODE_CODE.to_owned(),
                MODE_NO_CAST_ONLY as f64,
            ),
            (METRIC_VISUAL_CASTER_PAGES.to_owned(), 0.0),
            (METRIC_PROXY_CASTER_PAGES.to_owned(), 0.0),
            (METRIC_RUNTIME_TRIANGLES.to_owned(), 0.0),
        ]);
        let report = evaluate_clod_shadow_bench_metrics(
            &metrics,
            &ClodShadowBenchGuardThresholds::default(),
        );
        assert!(report.is_pass(), "{:?}", report.failure_messages());
    }

    #[test]
    fn missing_mode_code_fails() {
        let report = evaluate_clod_shadow_bench_metrics(
            &BTreeMap::new(),
            &ClodShadowBenchGuardThresholds::default(),
        );
        assert_eq!(report.status, ClodShadowGuardStatus::Fail);
        assert_eq!(report.mode_code, None);
    }
}
