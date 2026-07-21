import { describe, expect, it } from "vitest";
import bakerSource from "./tree_impostor_baker.ts?raw";
import captureSource from "./tree_impostor_capture_material.ts?raw";
import depthSource from "./tree_impostor_depth_reprojection.ts?raw";
import geometrySource from "./tree_gpu_ring_geometry.ts?raw";
import wrapperSource from "./tree_ring_impostor_node_material.ts?raw";

describe("tree impostor depth reprojection contract", () => {
  it("keeps runtime depth decode aligned with the bake camera", () => {
    expect(bakerSource).toContain("createTreeImpostorNormalDepthBakeMaterial(\n    0.01,\n    context.variantBounds.maxRadius * 6,");
    expect(bakerSource).toContain("camera.position.copy(direction).multiplyScalar(radius * 3)");
    expect(bakerSource).toContain("camera.near = 0.01");
    expect(bakerSource).toContain("camera.far = radius * 6");
    expect(captureSource).toContain("material.opacityNode = linearDepth");
    expect(captureSource).toContain("gl_FragColor = vec4(packedNormal, vTreeImpostorLinearDepth)");
  });

  it("coverage-weights depth across view and age layers", () => {
    expect(depthSource).toContain("depth: texture(atlas.normalDepth!, atlasUv).w");
    expect(depthSource).toContain("coverage: texture(atlas.albedo ?? atlas.texture, atlasUv).w");
    expect(depthSource).toContain("const cw00: TslNode = s00.coverage.mul(w00)");
    expect(depthSource).toContain("const lowerWeight: TslNode = float(1).sub(layerBlend).mul(lower.coverage)");
    expect(depthSource).toContain("cameraRay.mul(offsetM.mul(coverageWeight).mul(instanceScale))");
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
