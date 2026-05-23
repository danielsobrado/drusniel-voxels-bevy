//! Lengyel Transvoxel / modified Marching Cubes lookup tables.
//!
//! Tables are sourced from Eric Lengyel's Transvoxel Algorithm (https://transvoxel.org/)
//! via the `transvoxel-data` crate (MIT license, https://github.com/TheGreatB3/transvoxel-data-rs).
//!
//! Ambiguous MC cases (3, 6, 7, 10, 12, 13) are resolved by Lengyel's disambiguated
//! equivalence-class table — face-connected component policy, not raw 1987 Paul Bourke tables.

pub use transvoxel_data::regular_cell_data::{
    REGULAR_CELL_CLASS, REGULAR_CELL_DATA, REGULAR_VERTEX_DATA,
};
pub use transvoxel_data::transition_cell_data::{
    TRANSITION_CELL_CLASS, TRANSITION_CELL_DATA, TRANSITION_VERTEX_DATA,
};

/// Standard MC cube corner indices (Lengyel layout).
pub const CUBE_CORNERS: [[i32; 3]; 8] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_regular_cases_resolve() {
        for case in 0..256u16 {
            let class = REGULAR_CELL_CLASS[case as usize];
            let data = REGULAR_CELL_DATA[class as usize];
            let tri_count = data.get_triangle_count();
            assert!(tri_count <= 5, "case {case} tri_count {tri_count}");
            for t in 0..(tri_count as usize * 3) {
                let idx = data.vertex_index[t];
                assert!(idx == u8::MAX || idx < 12, "case {case} bad index {idx}");
            }
        }
    }

    #[test]
    fn all_transition_cases_resolve() {
        for case in 0..512usize {
            let raw = TRANSITION_CELL_CLASS[case];
            let class = raw & 0x7F;
            let data = TRANSITION_CELL_DATA[class as usize];
            let tri_count = data.get_triangle_count();
            assert!(tri_count <= 12, "case {case} tri_count {tri_count}");
            for t in 0..(tri_count as usize * 3) {
                let idx = data.vertex_index[t];
                assert!(idx == u8::MAX || idx < 12, "case {case} bad index {idx}");
            }
        }
    }
}
