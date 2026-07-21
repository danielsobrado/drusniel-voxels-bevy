import { describe, expect, it } from "vitest";
import bakerSource from "./tree_impostor_baker.ts?raw";
import captureSource from "./tree_impostor_capture_material.ts?raw";
import depthSource from "./tree_impostor_depth_reprojection.ts?raw";
import samplingSource from "./tree_impostor_depth_sampling.ts?raw";
import geometrySource from "./tree_gpu_ring_geometry.ts?raw";
import wrapperSource from "./tree_ring_impostor_node_material.ts?raw";

describe("tree impostor depth reprojection contract", () => {
  it("encodes depth relative to each centered age and variant layer", () => {
    expect(bakerSource).toContain("mesh.position.copy(bounds.center).multiplyScalar(-1)");
    expect(bakerSource).toContain("createTreeImpostorNormalDepthBakeMaterial(\n    0.01,\n    context.variantBounds.maxRadius * 6,");
    expect(captureSource).toContain("const relativeDepth: TslNode = dot(positionWorld, captureDirection)");
    expect(captureSource).toContain("material.opacityNode = encodedDepth");
    expect(captureSource).toContain("float relativeDepth = dot(worldPosition.xyz, captureDirection)");
    expect(captureSource).toContain("gl_FragColor = vec4(packedNormal, vTreeImpostorRelativeDepth)");
  });

  it("coverage-weights depth across view and age layers", () => {
    expect(samplingSource).toContain("depth: texture(atlas.normalDepth!, atlasUv).w");
    expect(samplingSource).toContain("coverage: texture(atlas.albedo ?? atlas.texture, atlasUv).w");
    expect(samplingSource).toContain("const cw00: TslNode = s00.coverage.mul(w00)");
    expect(samplingSource).toContain("const lowerWeight: TslNode = float(1).sub(layerBlend).mul(lower.coverage)");
    expect(depthSource).toContain("clamp(sample.depth, 0, 1).mul(2).sub(1).mul(range.extentM)");
  });

  it("scales depth with the same live morphology as the card", () => {
    expect(depthSource).toContain('attribute("treeHeight01", "float")');
    expect(depthSource).toContain("mix(0.72, 1.08, smoothstep(0, 1, age))");
    expect(depthSource).toContain("clamp(record.morphology1.z, 0.82, 1.18)");
    expect(depthSource).toContain("clamp(record.morphology1.w, 0.82, 1.2)");
    expect(depthSource).toContain("yawCos.mul(localDepth.x).add(yawSin.mul(localDepth.z))");
  });

  it("applies one identical transform to color and prepass", () => {
    expect(wrapperSource).toContain("material.positionNode = depthReprojection.apply(material.positionNode)");
    expect(wrapperSource).toContain("positionNode: depthReprojection.apply(nodes.positionNode as TslNode)");
    expect(wrapperSource).toContain('counters["tree_impostor_depth_prepass_parity"] = depthReprojectionActive ? 1 : 0');
    expect(wrapperSource).toContain('counters["tree_impostor_secondary_competition_response"] = 0');
  });

  it("tessellates baked GPU impostors without changing fallback geometry", () => {
    expect(geometrySource).toContain("createTreeImpostorDepthGridGeometry(\n    createTreeBakedImpostorGeometry(species, settings, atlas),");
    expect(geometrySource).toContain("return { geometry: fallback, bakedImpostor: false }");
  });
});
