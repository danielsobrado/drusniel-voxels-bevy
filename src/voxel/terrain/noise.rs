use super::TerrainGenerator;

// =============================================================================
// Noise Abstraction
// =============================================================================

/// Trait for noise generation algorithms.
///
/// Implement this trait to provide custom noise functions for terrain generation.
pub trait NoiseGenerator: Send + Sync {
    /// Samples 2D noise at the given coordinates.
    ///
    /// Returns a value in the range [0, 1].
    fn sample_2d(&self, x: f32, z: f32) -> f32;

    /// Samples 3D noise at the given coordinates.
    ///
    /// Returns a value in the range [0, 1].
    fn sample_3d(&self, x: f32, y: f32, z: f32) -> f32 {
        // Default implementation uses 2D noise with y offset
        self.sample_2d(x + y * 0.1, z + y * 0.1)
    }

    /// Generates fractal Brownian motion noise using multiple octaves.
    fn fbm_2d(&self, x: f32, z: f32, octaves: u32) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = 1.0;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.sample_2d(x * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        value / max_value
    }

    /// Generates 3D fractal Brownian motion noise.
    fn fbm_3d(&self, x: f32, y: f32, z: f32, octaves: u32) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = 1.0;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.sample_3d(x * frequency, y * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        value / max_value
    }
}

/// Default value noise implementation using hash-based pseudo-random numbers.
#[derive(Clone, Copy, Default)]
pub struct ValueNoise {
    seed: i32,
}

impl ValueNoise {
    /// Creates a new value noise generator with the given seed.
    pub fn new(seed: i32) -> Self {
        Self { seed }
    }

    /// Hash function for pseudo-random number generation.
    #[inline]
    fn hash(&self, x: i32, z: i32) -> f32 {
        let n = x
            .wrapping_mul(374761393)
            .wrapping_add(z.wrapping_mul(668265263))
            .wrapping_add(self.seed.wrapping_mul(1376312589));
        let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
        ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
    }

    /// Hash function for 3D coordinates.
    #[inline]
    fn hash_3d(&self, x: i32, y: i32, z: i32) -> f32 {
        let n = x
            .wrapping_mul(374761393)
            .wrapping_add(y.wrapping_mul(668265263))
            .wrapping_add(z.wrapping_mul(1274126177))
            .wrapping_add(self.seed.wrapping_mul(1376312589));
        let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
        ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
    }

    #[inline]
    fn smoothstep(t: f32) -> f32 {
        t * t * (3.0 - 2.0 * t)
    }

    #[inline]
    fn lerp(a: f32, b: f32, t: f32) -> f32 {
        a + t * (b - a)
    }
}

impl NoiseGenerator for ValueNoise {
    fn sample_2d(&self, x: f32, z: f32) -> f32 {
        let xi = x.floor() as i32;
        let zi = z.floor() as i32;
        let xf = x - x.floor();
        let zf = z - z.floor();

        let v00 = self.hash(xi, zi);
        let v10 = self.hash(xi + 1, zi);
        let v01 = self.hash(xi, zi + 1);
        let v11 = self.hash(xi + 1, zi + 1);

        let u = Self::smoothstep(xf);
        let v = Self::smoothstep(zf);

        Self::lerp(Self::lerp(v00, v10, u), Self::lerp(v01, v11, u), v)
    }

    fn sample_3d(&self, x: f32, y: f32, z: f32) -> f32 {
        let xi = x.floor() as i32;
        let yi = y.floor() as i32;
        let zi = z.floor() as i32;
        let xf = x - x.floor();
        let yf = y - y.floor();
        let zf = z - z.floor();

        let v000 = self.hash_3d(xi, yi, zi);
        let v100 = self.hash_3d(xi + 1, yi, zi);
        let v010 = self.hash_3d(xi, yi + 1, zi);
        let v110 = self.hash_3d(xi + 1, yi + 1, zi);
        let v001 = self.hash_3d(xi, yi, zi + 1);
        let v101 = self.hash_3d(xi + 1, yi, zi + 1);
        let v011 = self.hash_3d(xi, yi + 1, zi + 1);
        let v111 = self.hash_3d(xi + 1, yi + 1, zi + 1);

        let u = Self::smoothstep(xf);
        let v = Self::smoothstep(yf);
        let w = Self::smoothstep(zf);

        let x00 = Self::lerp(v000, v100, u);
        let x10 = Self::lerp(v010, v110, u);
        let x01 = Self::lerp(v001, v101, u);
        let x11 = Self::lerp(v011, v111, u);

        let y0 = Self::lerp(x00, x10, v);
        let y1 = Self::lerp(x01, x11, v);

        Self::lerp(y0, y1, w)
    }
}

impl<N: NoiseGenerator> TerrainGenerator<N> {
    #[inline]
    pub(super) fn hash_position(&self, x: i32, z: i32) -> f32 {
        hash_position_seeded(x, z, self.seed)
    }

    /// Configurable fBm noise using NoiseLayer parameters.
    pub(super) fn fbm_configurable(
        &self,
        x: f32,
        z: f32,
        scale: f32,
        octaves: u32,
        persistence: f32,
        lacunarity: f32,
    ) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = scale;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.noise.sample_2d(x * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        value / max_value
    }
}

/// Simple hash function for deterministic pseudo-random values.
#[inline]
pub fn hash_position(x: i32, z: i32) -> f32 {
    hash_position_seeded(x, z, 0)
}

#[inline]
pub fn hash_position_seeded(x: i32, z: i32, seed: i32) -> f32 {
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263))
        .wrapping_add(seed.wrapping_mul(1376312589));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
}
