const BIOME_MEADOWS : u32 = 0u;
const BIOME_FOREST : u32 = 1u;
const BIOME_SWAMP : u32 = 2u;
const BIOME_MOUNTAIN : u32 = 3u;
const BIOME_PLAINS : u32 = 4u;
const BIOME_COAST : u32 = 5u;
const BIOME_OCEAN : u32 = 6u;

const MATERIAL_GRASS : u32 = 0u;
const MATERIAL_FOREST_FLOOR : u32 = 1u;
const MATERIAL_MUD : u32 = 2u;
const MATERIAL_ROCK : u32 = 3u;
const MATERIAL_DRY_GRASS : u32 = 4u;
const MATERIAL_SAND : u32 = 5u;
const MATERIAL_OCEAN_BED : u32 = 6u;

struct BiomeSplatSample {
    layers : vec4<u32>,
    weights : vec4<f32>,
};

fn normalize_biome_splat(sample : BiomeSplatSample) -> BiomeSplatSample {
    let sum = sample.weights.x + sample.weights.y + sample.weights.z + sample.weights.w;
    if (sum <= 0.000001) {
        return BiomeSplatSample(sample.layers, vec4<f32>(1.0, 0.0, 0.0, 0.0));
    }
    return BiomeSplatSample(sample.layers, clamp(sample.weights / sum, vec4<f32>(0.0), vec4<f32>(1.0)));
}

fn biome_splat_sample(biome : u32, height : f32, sea_level : f32, slope : f32) -> BiomeSplatSample {
    let rock_weight = clamp((slope - 0.55) / 0.35, 0.0, 1.0);
    let shore_weight = clamp((sea_level + 5.0 - height) / 9.0, 0.0, 1.0);

    if (biome == BIOME_OCEAN) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_OCEAN_BED, MATERIAL_SAND, MATERIAL_ROCK, MATERIAL_MUD),
            vec4<f32>(1.0 - shore_weight * 0.35, shore_weight * 0.35, 0.0, 0.0),
        ));
    }
    if (biome == BIOME_COAST) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_SAND, MATERIAL_ROCK, MATERIAL_GRASS, MATERIAL_MUD),
            vec4<f32>(1.0 - rock_weight * 0.45, rock_weight * 0.45, 0.0, 0.0),
        ));
    }
    if (biome == BIOME_MOUNTAIN) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_ROCK, MATERIAL_GRASS, MATERIAL_FOREST_FLOOR, MATERIAL_SAND),
            vec4<f32>(0.72 + rock_weight * 0.28, (1.0 - rock_weight) * 0.2, (1.0 - rock_weight) * 0.08, 0.0),
        ));
    }
    if (biome == BIOME_SWAMP) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_MUD, MATERIAL_FOREST_FLOOR, MATERIAL_GRASS, MATERIAL_SAND),
            vec4<f32>(0.68, 0.22, 0.1, 0.0),
        ));
    }
    if (biome == BIOME_PLAINS) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_DRY_GRASS, MATERIAL_GRASS, MATERIAL_SAND, MATERIAL_ROCK),
            vec4<f32>(0.72, 0.2, 0.08, rock_weight * 0.12),
        ));
    }
    if (biome == BIOME_FOREST) {
        return normalize_biome_splat(BiomeSplatSample(
            vec4<u32>(MATERIAL_FOREST_FLOOR, MATERIAL_GRASS, MATERIAL_ROCK, MATERIAL_MUD),
            vec4<f32>(0.72, 0.2 * (1.0 - rock_weight), rock_weight * 0.18, 0.0),
        ));
    }
    return normalize_biome_splat(BiomeSplatSample(
        vec4<u32>(MATERIAL_GRASS, MATERIAL_FOREST_FLOOR, MATERIAL_SAND, MATERIAL_ROCK),
        vec4<f32>(0.78 - shore_weight * 0.3, 0.14, shore_weight * 0.3, rock_weight * 0.08),
    ));
}

fn biome_splat_dominant_layer(sample : BiomeSplatSample) -> u32 {
    var best = 0u;
    if (sample.weights.y > sample.weights.x) { best = 1u; }
    if (sample.weights.z > sample.weights[best]) { best = 2u; }
    if (sample.weights.w > sample.weights[best]) { best = 3u; }
    return sample.layers[best];
}

fn biome_splat_layer_to_triplanar_weight(layer : u32, weight : f32) -> vec4<f32> {
    if (layer == MATERIAL_ROCK) { return vec4<f32>(0.0, weight, 0.0, 0.0); }
    if (layer == MATERIAL_SAND || layer == MATERIAL_OCEAN_BED) { return vec4<f32>(0.0, 0.0, weight, 0.0); }
    if (layer == MATERIAL_MUD) { return vec4<f32>(0.0, 0.0, 0.0, weight); }
    return vec4<f32>(weight, 0.0, 0.0, 0.0);
}

fn biome_splat_to_triplanar_weights(sample : BiomeSplatSample) -> vec4<f32> {
    let weights = biome_splat_layer_to_triplanar_weight(sample.layers.x, sample.weights.x)
        + biome_splat_layer_to_triplanar_weight(sample.layers.y, sample.weights.y)
        + biome_splat_layer_to_triplanar_weight(sample.layers.z, sample.weights.z)
        + biome_splat_layer_to_triplanar_weight(sample.layers.w, sample.weights.w);
    let sum = weights.x + weights.y + weights.z + weights.w;
    if (sum <= 0.000001) {
        return vec4<f32>(1.0, 0.0, 0.0, 0.0);
    }
    return weights / sum;
}

fn biome_splat_resolve_triplanar_weights(
    vertex_weights : vec4<f32>,
    biome : u32,
    height : f32,
    sea_level : f32,
    slope : f32,
    enabled : bool,
) -> vec4<f32> {
#ifdef TERRAIN_VERTEX_SPLAT_CACHE
    return vertex_weights;
#endif
    if (!enabled) {
        return vertex_weights;
    }
    return biome_splat_to_triplanar_weights(biome_splat_sample(biome, height, sea_level, slope));
}
