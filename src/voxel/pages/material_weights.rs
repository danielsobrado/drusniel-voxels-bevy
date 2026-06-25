//! Material weight validation and assertion.
//! Ported from tools/clod-poc/src/materialWeights.ts.

use super::types::{ClodBuildError, PageMesh};

/// Assert the mesh carries explicit material weights with valid stride.
/// Builder paths MUST call this — a source path that forgets to generate real terrain
/// weights fails loud instead of silently inheriting defaults.
pub fn assert_material_weights(mesh: &PageMesh, label: &str) -> Result<(), ClodBuildError> {
    let vc = mesh.vertex_count();
    let stride = mesh.material_weight_stride();
    if stride == 0 {
        return Err(ClodBuildError::MissingMaterialWeights {
            message: format!("{label}: material_weight_stride is 0"),
        });
    }
    let expected = vc * stride;
    if mesh.material_weights().len() != expected {
        return Err(ClodBuildError::MissingMaterialWeights {
            message: format!(
                "{label}: material_weights length {} != vc({vc}) * stride({stride})",
                mesh.material_weights().len(),
            ),
        });
    }
    Ok(())
}

/// Validate material weight invariants: all finite, in [0,1], sum ≈ 1 per vertex.
pub fn validate_material_weights(
    mesh: &PageMesh,
    label: &str,
    epsilon: f32,
) -> Result<(), ClodBuildError> {
    let vc = mesh.vertex_count();
    let stride = mesh.material_weight_stride();
    if mesh.materials.is_empty() && vc == 0 {
        return Ok(());
    }
    if stride == 0 {
        return Err(ClodBuildError::MissingMaterialWeights {
            message: format!("{label}: material_weight_stride is 0 (vc={vc})"),
        });
    }
    let weights = mesh.material_weights();
    let expected = vc * stride;
    if weights.len() != expected {
        return Err(ClodBuildError::MissingMaterialWeights {
            message: format!(
                "{label}: material_weights length {} != vc({vc}) * stride({stride})",
                weights.len(),
            ),
        });
    }
    for i in 0..vc {
        let mut sum = 0.0;
        for j in 0..stride {
            let w = weights[i * stride + j];
            if !w.is_finite() {
                return Err(ClodBuildError::DirtyInput {
                    message: format!(
                        "{label}: vertex {i} material weight channel {j} is not finite ({w})"
                    ),
                });
            }
            if w < 0.0 || w > 1.0 {
                return Err(ClodBuildError::DirtyInput {
                    message: format!(
                        "{label}: vertex {i} material weight channel {j}={w:.4} outside [0,1]"
                    ),
                });
            }
            sum += w;
        }
        if (sum - 1.0).abs() > epsilon {
            return Err(ClodBuildError::DirtyInput {
                message: format!(
                    "{label}: vertex {i} material weights sum to {sum:.4}, expected ~1"
                ),
            });
        }
    }
    Ok(())
}
