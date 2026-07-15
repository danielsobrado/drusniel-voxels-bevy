import type { TreeInstanceMorphology } from "./types.js";

export interface TreeMorphologyDiagnostics {
  tree_morphology_enabled: boolean;
  tree_morphology_instances: number;
  tree_morphology_age_mean: number;
  tree_morphology_age_p10: number;
  tree_morphology_age_p90: number;
  tree_morphology_lean_mean: number;
  tree_morphology_lean_max: number;
  tree_morphology_health_mean: number;
  tree_morphology_foliage_mean: number;
  tree_morphology_competition_samples: number;
  tree_morphology_impostor_layers_ready: number;
  tree_morphology_cpu_gpu_mismatches: number;
  tree_morphology_instance_bytes: number;
}

export function summarizeTreeMorphology(instances: readonly TreeInstanceMorphology[]): TreeMorphologyDiagnostics {
  const ages = instances.map((value) => value.age01).sort((a, b) => a - b);
  const leans = instances.map((value) => Math.hypot(value.leanX, value.leanZ));
  return {
    tree_morphology_enabled: true,
    tree_morphology_instances: instances.length,
    tree_morphology_age_mean: mean(ages),
    tree_morphology_age_p10: percentile(ages, 0.1),
    tree_morphology_age_p90: percentile(ages, 0.9),
    tree_morphology_lean_mean: mean(leans),
    tree_morphology_lean_max: leans.length ? Math.max(...leans) : 0,
    tree_morphology_health_mean: mean(instances.map((value) => value.health01)),
    tree_morphology_foliage_mean: mean(instances.map((value) => value.foliageDensity)),
    tree_morphology_competition_samples: instances.length * 24,
    tree_morphology_impostor_layers_ready: 0,
    tree_morphology_cpu_gpu_mismatches: 0,
    tree_morphology_instance_bytes: instances.length * 48,
  };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0;
}
