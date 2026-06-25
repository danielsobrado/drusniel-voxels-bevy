use super::config::DiagonalFlipConfig;
use super::triangle_quality::{
    Vec3, add, dot, finite_vec3, material_distance_squared, normalize, triangle_area,
    triangle_min_angle_degrees, triangle_normal,
};
use super::types::PageMesh;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Diagonal {
    Ac,
    Bd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagonalChoice {
    Keep,
    Flip,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagonalRejectReason {
    Degenerate,
    Winding,
}

#[derive(Debug, Clone)]
pub struct QuadVertex {
    pub position: Vec3,
    pub normal: Option<Vec3>,
    pub material: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct DiagonalDecision {
    pub choice: DiagonalChoice,
    pub chosen_diagonal: Option<Diagonal>,
    pub reason: Option<DiagonalRejectReason>,
    pub score_improvement: f32,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DiagonalPolishStats {
    pub candidate_quads: u32,
    pub flipped: u32,
    pub rejected_degenerate: u32,
    pub rejected_winding: u32,
    pub rejected_locked_border: u32,
    pub rejected_no_improvement: u32,
    pub average_score_improvement: f32,
}

impl DiagonalPolishStats {
    pub fn add_assign(&mut self, other: &Self) {
        let total_improvement = self.average_score_improvement * self.flipped as f32
            + other.average_score_improvement * other.flipped as f32;
        self.candidate_quads += other.candidate_quads;
        self.flipped += other.flipped;
        self.rejected_degenerate += other.rejected_degenerate;
        self.rejected_winding += other.rejected_winding;
        self.rejected_locked_border += other.rejected_locked_border;
        self.rejected_no_improvement += other.rejected_no_improvement;
        self.average_score_improvement = if self.flipped > 0 {
            total_improvement / self.flipped as f32
        } else {
            0.0
        };
    }
}

#[derive(Clone, Copy)]
struct EdgeUse {
    tri_start: usize,
    tri_index: usize,
    opposite: u32,
}

struct CandidateMetrics {
    valid: bool,
    reason: Option<DiagonalRejectReason>,
    score: f32,
}

const EPS: f32 = 1e-6;

pub fn choose_best_quad_diagonal(
    a: &QuadVertex,
    b: &QuadVertex,
    c: &QuadVertex,
    d: &QuadVertex,
    current_diagonal: Diagonal,
    config: &DiagonalFlipConfig,
) -> DiagonalDecision {
    let Some(expected) = expected_normal([a, b, c, d], current_diagonal, config) else {
        return DiagonalDecision {
            choice: DiagonalChoice::Reject,
            chosen_diagonal: None,
            reason: Some(DiagonalRejectReason::Degenerate),
            score_improvement: 0.0,
        };
    };

    let ac = evaluate_candidate(Diagonal::Ac, a, b, c, d, expected, config);
    let bd = evaluate_candidate(Diagonal::Bd, a, b, c, d, expected, config);
    let (current, alternate, alternate_diagonal) = match current_diagonal {
        Diagonal::Ac => (&ac, &bd, Diagonal::Bd),
        Diagonal::Bd => (&bd, &ac, Diagonal::Ac),
    };

    if !current.valid && !alternate.valid {
        return DiagonalDecision {
            choice: DiagonalChoice::Reject,
            chosen_diagonal: None,
            reason: if current.reason == Some(DiagonalRejectReason::Degenerate)
                || alternate.reason == Some(DiagonalRejectReason::Degenerate)
            {
                Some(DiagonalRejectReason::Degenerate)
            } else {
                Some(DiagonalRejectReason::Winding)
            },
            score_improvement: 0.0,
        };
    }
    if !current.valid && alternate.valid {
        return DiagonalDecision {
            choice: DiagonalChoice::Flip,
            chosen_diagonal: Some(alternate_diagonal),
            reason: None,
            score_improvement: 0.0,
        };
    }
    if current.valid && !alternate.valid {
        return DiagonalDecision {
            choice: DiagonalChoice::Keep,
            chosen_diagonal: Some(current_diagonal),
            reason: alternate.reason,
            score_improvement: 0.0,
        };
    }

    if alternate.score + EPS < current.score {
        flip(alternate_diagonal, current.score - alternate.score)
    } else {
        keep(current_diagonal)
    }
}

pub fn polish_diagonals(
    mesh: &mut PageMesh,
    locks: &[bool],
    config: &DiagonalFlipConfig,
) -> DiagonalPolishStats {
    let mut stats = DiagonalPolishStats::default();
    if !config.enabled {
        return stats;
    }

    let edge_map = build_edge_map(&mesh.indices);
    let mut used_triangles = HashSet::new();
    let mut total_improvement = 0.0;
    for ((a, c), uses) in edge_map {
        if uses.len() != 2 {
            continue;
        }
        let u0 = uses[0];
        let u1 = uses[1];
        if used_triangles.contains(&u0.tri_index) || used_triangles.contains(&u1.tri_index) {
            continue;
        }
        stats.candidate_quads += 1;
        if locks.get(a as usize).copied().unwrap_or(false)
            && locks.get(c as usize).copied().unwrap_or(false)
        {
            stats.rejected_locked_border += 1;
            used_triangles.insert(u0.tri_index);
            used_triangles.insert(u1.tri_index);
            continue;
        }

        let Some((a, b, c, d)) =
            orient_current_diagonal(mesh, a, c, u0.opposite, u1.opposite, config)
        else {
            stats.rejected_winding += 1;
            used_triangles.insert(u0.tri_index);
            used_triangles.insert(u1.tri_index);
            continue;
        };

        let decision = choose_best_quad_diagonal(
            &vertex(mesh, a),
            &vertex(mesh, b),
            &vertex(mesh, c),
            &vertex(mesh, d),
            Diagonal::Ac,
            config,
        );
        used_triangles.insert(u0.tri_index);
        used_triangles.insert(u1.tri_index);
        match decision.choice {
            DiagonalChoice::Flip => {
                mesh.indices[u0.tri_start..u0.tri_start + 3].copy_from_slice(&[a, b, d]);
                mesh.indices[u1.tri_start..u1.tri_start + 3].copy_from_slice(&[b, c, d]);
                stats.flipped += 1;
                total_improvement += decision.score_improvement;
            }
            DiagonalChoice::Reject => match decision.reason {
                Some(DiagonalRejectReason::Degenerate) => stats.rejected_degenerate += 1,
                Some(DiagonalRejectReason::Winding) | None => stats.rejected_winding += 1,
            },
            DiagonalChoice::Keep => match decision.reason {
                Some(DiagonalRejectReason::Degenerate) => stats.rejected_degenerate += 1,
                Some(DiagonalRejectReason::Winding) => stats.rejected_winding += 1,
                None => stats.rejected_no_improvement += 1,
            },
        }
    }

    if stats.flipped > 0 {
        stats.average_score_improvement = total_improvement / stats.flipped as f32;
    }

    stats
}

fn flip(chosen: Diagonal, score_improvement: f32) -> DiagonalDecision {
    DiagonalDecision {
        choice: DiagonalChoice::Flip,
        chosen_diagonal: Some(chosen),
        reason: None,
        score_improvement,
    }
}

fn keep(chosen: Diagonal) -> DiagonalDecision {
    DiagonalDecision {
        choice: DiagonalChoice::Keep,
        chosen_diagonal: Some(chosen),
        reason: None,
        score_improvement: 0.0,
    }
}

fn evaluate_candidate(
    diagonal: Diagonal,
    a: &QuadVertex,
    b: &QuadVertex,
    c: &QuadVertex,
    d: &QuadVertex,
    expected: Vec3,
    config: &DiagonalFlipConfig,
) -> CandidateMetrics {
    let tris = match diagonal {
        Diagonal::Ac => [[a, b, c], [a, c, d]],
        Diagonal::Bd => [[a, b, d], [b, c, d]],
    };
    let mut min_angle_degrees = f32::INFINITY;
    let mut normal_error = 0.0;
    for tri in tris {
        let [x, y, z] = tri;
        if !finite_vec3(x.position) || !finite_vec3(y.position) || !finite_vec3(z.position) {
            return invalid(DiagonalRejectReason::Degenerate);
        }
        let area = triangle_area(x.position, y.position, z.position);
        let Some(face_normal) = triangle_normal(x.position, y.position, z.position) else {
            return invalid(DiagonalRejectReason::Degenerate);
        };
        if !area.is_finite() || area <= config.min_triangle_area {
            return invalid(DiagonalRejectReason::Degenerate);
        }
        if dot(face_normal, expected) < config.min_normal_dot {
            return invalid(DiagonalRejectReason::Winding);
        }
        min_angle_degrees = min_angle_degrees.min(triangle_min_angle_degrees(
            x.position, y.position, z.position,
        ));
        if let Some(avg) = average_normal(&tri) {
            normal_error += 1.0 - dot(face_normal, avg).clamp(-1.0, 1.0);
        }
    }

    let material_error = match diagonal {
        Diagonal::Ac => material_distance_squared(&a.material, &c.material),
        Diagonal::Bd => material_distance_squared(&b.material, &d.material),
    };
    let angle_cost = (90.0 - min_angle_degrees) / 90.0;
    CandidateMetrics {
        valid: true,
        reason: None,
        score: config.angle_quality_weight * angle_cost
            + config.normal_error_weight * normal_error
            + config.material_error_weight * material_error,
    }
}

fn expected_normal(
    vertices: [&QuadVertex; 4],
    current_diagonal: Diagonal,
    config: &DiagonalFlipConfig,
) -> Option<Vec3> {
    if let Some(avg) = average_normal(&vertices) {
        return Some(avg);
    }
    let fallback = DiagonalFlipConfig {
        min_normal_dot: -1.0,
        ..config.clone()
    };
    let current = evaluate_candidate(
        current_diagonal,
        vertices[0],
        vertices[1],
        vertices[2],
        vertices[3],
        [0.0, 1.0, 0.0],
        &fallback,
    );
    if !current.valid {
        return None;
    }
    let tris = match current_diagonal {
        Diagonal::Ac => [
            [vertices[0], vertices[1], vertices[2]],
            [vertices[0], vertices[2], vertices[3]],
        ],
        Diagonal::Bd => [
            [vertices[0], vertices[1], vertices[3]],
            [vertices[1], vertices[2], vertices[3]],
        ],
    };
    let n0 = triangle_normal(
        tris[0][0].position,
        tris[0][1].position,
        tris[0][2].position,
    )?;
    let n1 = triangle_normal(
        tris[1][0].position,
        tris[1][1].position,
        tris[1][2].position,
    )?;
    normalize(add(n0, n1))
}

fn average_normal(vertices: &[&QuadVertex]) -> Option<Vec3> {
    let mut sum = [0.0, 0.0, 0.0];
    for vertex in vertices {
        let normal = vertex.normal?;
        if !finite_vec3(normal) {
            return None;
        }
        sum = add(sum, normal);
    }
    normalize(sum)
}

fn invalid(reason: DiagonalRejectReason) -> CandidateMetrics {
    CandidateMetrics {
        valid: false,
        reason: Some(reason),
        score: f32::INFINITY,
    }
}

fn build_edge_map(indices: &[u32]) -> BTreeMap<(u32, u32), Vec<EdgeUse>> {
    let mut map: BTreeMap<(u32, u32), Vec<EdgeUse>> = BTreeMap::new();
    for tri_start in (0..indices.len()).step_by(3) {
        let tri_index = tri_start / 3;
        let tri = [
            indices[tri_start],
            indices[tri_start + 1],
            indices[tri_start + 2],
        ];
        for i in 0..3 {
            let a = tri[i];
            let c = tri[(i + 1) % 3];
            let key = (a.min(c), a.max(c));
            map.entry(key).or_default().push(EdgeUse {
                tri_start,
                tri_index,
                opposite: tri[(i + 2) % 3],
            });
        }
    }
    map
}

fn orient_current_diagonal(
    mesh: &PageMesh,
    a: u32,
    c: u32,
    first_opposite: u32,
    second_opposite: u32,
    config: &DiagonalFlipConfig,
) -> Option<(u32, u32, u32, u32)> {
    let first = (a, first_opposite, c, second_opposite);
    if current_diagonal_is_valid(mesh, first, config) {
        return Some(first);
    }
    let second = (a, second_opposite, c, first_opposite);
    current_diagonal_is_valid(mesh, second, config).then_some(second)
}

fn current_diagonal_is_valid(
    mesh: &PageMesh,
    quad: (u32, u32, u32, u32),
    config: &DiagonalFlipConfig,
) -> bool {
    let a = vertex(mesh, quad.0);
    let b = vertex(mesh, quad.1);
    let c = vertex(mesh, quad.2);
    let d = vertex(mesh, quad.3);
    let Some(expected) = expected_normal([&a, &b, &c, &d], Diagonal::Ac, config) else {
        return false;
    };
    evaluate_candidate(Diagonal::Ac, &a, &b, &c, &d, expected, config).valid
}

fn vertex(mesh: &PageMesh, i: u32) -> QuadVertex {
    let idx = i as usize;
    QuadVertex {
        position: mesh.positions[idx],
        normal: mesh.normals.get(idx).copied(),
        material: mesh
            .materials
            .get(idx)
            .map(|m| m.to_vec())
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixture {
        positions: Vec<[f32; 3]>,
        normals: Vec<[f32; 3]>,
        material_weights: Vec<[f32; 4]>,
        current_diagonal: String,
        expected_choice: String,
    }

    fn v(position: [f32; 3], material: Vec<f32>) -> QuadVertex {
        QuadVertex {
            position,
            normal: Some([0.0, 1.0, 0.0]),
            material,
        }
    }

    fn quad_mesh(materials: Vec<[f32; 4]>) -> PageMesh {
        let n = materials.len();
        PageMesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                [1.0, 0.0, 0.0],
            ],
            normals: vec![[0.0, 1.0, 0.0]; 4],
            materials,
            paint_slots: vec![0.0; n],
            material_weight_stride: 4,
            indices: vec![0, 1, 2, 0, 2, 3],
        }
    }

    #[test]
    fn flips_diamond_when_current_diagonal_is_skinny() {
        let cfg = DiagonalFlipConfig::default();
        let decision = choose_best_quad_diagonal(
            &v([0.0, 0.0, 0.0], vec![0.0]),
            &v([0.0, 0.0, 1.0], vec![0.0]),
            &v([0.05, 0.0, 0.8], vec![0.0]),
            &v([0.05, 0.0, 0.5], vec![0.0]),
            Diagonal::Ac,
            &cfg,
        );
        assert_eq!(decision.choice, DiagonalChoice::Flip);
        assert_eq!(decision.chosen_diagonal, Some(Diagonal::Bd));
    }

    #[test]
    fn keeps_planar_square_tie() {
        let cfg = DiagonalFlipConfig::default();
        let decision = choose_best_quad_diagonal(
            &v([0.0, 0.0, 0.0], vec![0.0]),
            &v([0.0, 0.0, 1.0], vec![0.0]),
            &v([1.0, 0.0, 1.0], vec![0.0]),
            &v([1.0, 0.0, 0.0], vec![0.0]),
            Diagonal::Ac,
            &cfg,
        );
        assert_eq!(decision.choice, DiagonalChoice::Keep);
        assert_eq!(decision.chosen_diagonal, Some(Diagonal::Ac));
    }

    #[test]
    fn rejects_flipped_winding_alternate() {
        let cfg = DiagonalFlipConfig {
            min_angle_improvement_degrees: 0.0,
            ..Default::default()
        };
        let decision = choose_best_quad_diagonal(
            &v([0.0, 0.0, 0.0], vec![0.0]),
            &v([0.0, 0.0, 1.0], vec![0.0]),
            &v([0.1, 0.0, -2.0], vec![0.0]),
            &v([-2.0, 0.0, -1.0], vec![0.0]),
            Diagonal::Ac,
            &cfg,
        );
        assert_eq!(decision.choice, DiagonalChoice::Keep);
        assert_eq!(decision.reason, Some(DiagonalRejectReason::Winding));
    }

    #[test]
    fn locked_shared_edge_does_not_flip() {
        let cfg = DiagonalFlipConfig::default();
        let mut mesh = quad_mesh(vec![
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
        ]);
        let stats = polish_diagonals(&mut mesh, &[true, false, true, false], &cfg);
        assert_eq!(stats.candidate_quads, 1);
        assert_eq!(stats.flipped, 0);
        assert_eq!(stats.rejected_locked_border, 1);
        assert_eq!(mesh.indices, vec![0, 1, 2, 0, 2, 3]);
    }

    #[test]
    fn material_boundary_prefers_continuous_diagonal() {
        let cfg = DiagonalFlipConfig::default();
        let decision = choose_best_quad_diagonal(
            &v([0.0, 0.0, 0.0], vec![1.0, 0.0, 0.0, 0.0]),
            &v([0.0, 0.0, 1.0], vec![0.0, 1.0, 0.0, 0.0]),
            &v([1.0, 0.0, 1.0], vec![0.0, 0.0, 1.0, 0.0]),
            &v([1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]),
            Diagonal::Ac,
            &cfg,
        );
        assert_eq!(decision.choice, DiagonalChoice::Flip);
        assert_eq!(decision.chosen_diagonal, Some(Diagonal::Bd));
    }

    #[test]
    fn material_weight_zero_does_not_choose_by_material() {
        let cfg = DiagonalFlipConfig {
            material_error_weight: 0.0,
            ..Default::default()
        };
        let decision = choose_best_quad_diagonal(
            &v([0.0, 0.0, 0.0], vec![1.0, 0.0, 0.0, 0.0]),
            &v([0.0, 0.0, 1.0], vec![0.0, 1.0, 0.0, 0.0]),
            &v([1.0, 0.0, 1.0], vec![0.0, 0.0, 1.0, 0.0]),
            &v([1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0]),
            Diagonal::Ac,
            &cfg,
        );
        assert_eq!(decision.choice, DiagonalChoice::Keep);
        assert_eq!(decision.chosen_diagonal, Some(Diagonal::Ac));
    }

    #[test]
    fn shared_fixture_matches_expected_choice() {
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../tests/fixtures/clod/diagonal_polish.json"
        ))
        .expect("fixture parses");
        let vertices = (0..4)
            .map(|i| QuadVertex {
                position: fixture.positions[i],
                normal: Some(fixture.normals[i]),
                material: fixture.material_weights[i].to_vec(),
            })
            .collect::<Vec<_>>();
        let current = match fixture.current_diagonal.as_str() {
            "ac" => Diagonal::Ac,
            "bd" => Diagonal::Bd,
            other => panic!("unknown diagonal {other}"),
        };
        let decision = choose_best_quad_diagonal(
            &vertices[0],
            &vertices[1],
            &vertices[2],
            &vertices[3],
            current,
            &DiagonalFlipConfig::default(),
        );
        assert_eq!(
            format!("{:?}", decision.choice).to_lowercase(),
            fixture.expected_choice
        );
    }
}
