// Shared contract for terrain_classification_a support maps.
// Channels: snow, wetness, vegetation density, rock/cliff exposure.

struct TerrainClassificationSample {
    classification_a: vec4<f32>,
};
