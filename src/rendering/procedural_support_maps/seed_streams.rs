pub const PROCEDURAL_SEED_STREAM_IDS: [&str; 7] = [
    "noise_value",
    "noise_fbm",
    "noise_ridged",
    "noise_worley",
    "material_macro",
    "material_meso",
    "material_micro",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProceduralSeedStreams {
    pub noise_value: u32,
    pub noise_fbm: u32,
    pub noise_ridged: u32,
    pub noise_worley: u32,
    pub material_macro: u32,
    pub material_meso: u32,
    pub material_micro: u32,
}

pub fn stable_seed_stream(root_seed: u32, stream: &str) -> u32 {
    let mut hash = root_seed ^ 0x811c_9dc5;
    for byte in stream.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x7feb_352d);
    hash ^= hash >> 15;
    hash = hash.wrapping_mul(0x846c_a68b);
    hash ^ (hash >> 16)
}

pub fn derive_seed_streams(root_seed: u32) -> ProceduralSeedStreams {
    ProceduralSeedStreams {
        noise_value: stable_seed_stream(root_seed, "noise_value"),
        noise_fbm: stable_seed_stream(root_seed, "noise_fbm"),
        noise_ridged: stable_seed_stream(root_seed, "noise_ridged"),
        noise_worley: stable_seed_stream(root_seed, "noise_worley"),
        material_macro: stable_seed_stream(root_seed, "material_macro"),
        material_meso: stable_seed_stream(root_seed, "material_meso"),
        material_micro: stable_seed_stream(root_seed, "material_micro"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn derives_stable_independent_seed_streams() {
        let streams = derive_seed_streams(1337);
        assert_eq!(streams, derive_seed_streams(1337));
        assert_eq!(streams.noise_value, stable_seed_stream(1337, "noise_value"));
        assert_ne!(streams.noise_value, derive_seed_streams(1338).noise_value);
        assert_ne!(streams.noise_value, streams.noise_fbm);
        let unique = BTreeSet::from([
            streams.noise_value,
            streams.noise_fbm,
            streams.noise_ridged,
            streams.noise_worley,
            streams.material_macro,
            streams.material_meso,
            streams.material_micro,
        ]);
        assert_eq!(unique.len(), PROCEDURAL_SEED_STREAM_IDS.len());
    }
}
