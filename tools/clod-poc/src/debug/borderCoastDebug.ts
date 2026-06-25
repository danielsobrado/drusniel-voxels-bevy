import * as THREE from "three";
import type GUI from "lil-gui";
import { sampleCoastMask } from "../border/coastMask.js";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";

export interface BorderCoastDebugStats {
  coastType: string;
  distanceToBorder: number;
}

export interface BorderCoastDebugDeps {
  gui: GUI;
  scene: THREE.Scene;
  config: BorderCoastOceanConfig;
  seed: number;
  onCoastShapingChanged(enabled: boolean): void;
}

export interface BorderCoastDebugController {
  stats: BorderCoastDebugStats;
  updateProbe(position: { x: number; z: number }): void;
  dispose(): void;
}

export function createBorderCoastDebug(deps: BorderCoastDebugDeps): BorderCoastDebugController {
  const state = {
    coastShaping: deps.config.coast.enabled,
    showWorldBounds: deps.config.debug.show_world_bounds,
    showDistortedCoastline: false,
    showCoastBand: deps.config.debug.show_coast_band,
    showCoastTypeColors: deps.config.debug.show_coast_type,
  };
  const stats: BorderCoastDebugStats = { coastType: "inland", distanceToBorder: Infinity };
  const root = new THREE.Group();
  root.name = "border-coast-debug";
  deps.scene.add(root);

  const folder = deps.gui.addFolder("Border coast");
  folder.add(state, "coastShaping").name("coast shaping").onChange((enabled: boolean) => {
    deps.onCoastShapingChanged(enabled);
  });
  folder.add(state, "showWorldBounds").name("world bounds").onChange(rebuild);
  folder.add(state, "showDistortedCoastline").name("distorted coastline").onChange(rebuild);
  folder.add(state, "showCoastBand").name("coast band").onChange(rebuild);
  folder.add(state, "showCoastTypeColors").name("coast type colors").onChange(rebuild);
  folder.add(stats, "coastType").name("coast under probe").listen().disable();
  folder.add(stats, "distanceToBorder").name("border distance").listen().disable();

  function rebuild(): void {
    disposeChildren(root);
    if (state.showWorldBounds) {
      root.add(rectangleLine(deps.config.world.bounds, 0xffff00, deps.config.world.water_level + 0.3));
    }
    if (state.showDistortedCoastline) root.add(sampledCoastLine(0, 0xffffff));
    if (state.showCoastBand) {
      root.add(sampledCoastLine(deps.config.coast.band.width_m, 0x33ccff));
    }
    if (state.showCoastTypeColors) root.add(coastTypePoints());
  }

  function sampledCoastLine(distanceOffset: number, color: number): THREE.LineSegments {
    const points = samplePerimeter(256).map((point) => {
      const mask = sampleCoastMask(point, deps.config.world.bounds, deps.config.coast, deps.seed);
      return new THREE.Vector3(
        point.x - mask.nearestBorderNormal.x * (mask.distortedDistanceToBorder - distanceOffset),
        deps.config.world.water_level + 0.4,
        point.z - mask.nearestBorderNormal.z * (mask.distortedDistanceToBorder - distanceOffset),
      );
    });
    const segments: THREE.Vector3[] = [];
    for (let index = 0; index < points.length; index += 1) {
      segments.push(points[index], points[(index + 1) % points.length]);
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(segments),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
  }

  function coastTypePoints(): THREE.Points {
    const positions: number[] = [];
    const colors: number[] = [];
    const palette: Record<string, THREE.Color> = {
      sandyBeach: new THREE.Color(0xf0ca6b),
      rockyBeach: new THREE.Color(0x806550),
      cliff: new THREE.Color(0xcc5533),
      cove: new THREE.Color(0x55aacc),
      reef: new THREE.Color(0x33ccaa),
    };
    for (const point of samplePerimeter(192)) {
      const mask = sampleCoastMask(point, deps.config.world.bounds, deps.config.coast, deps.seed);
      const color = palette[mask.coastType];
      positions.push(point.x, deps.config.world.water_level + 0.6, point.z);
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthTest: false }),
    );
  }

  function samplePerimeter(count: number): Array<{ x: number; z: number }> {
    const bounds = deps.config.world.bounds;
    const width = bounds.max_x - bounds.min_x;
    const height = bounds.max_z - bounds.min_z;
    const perimeter = 2 * (width + height);
    return Array.from({ length: count }, (_, index) => {
      let distance = index / count * perimeter;
      if (distance <= width) return { x: bounds.min_x + distance, z: bounds.min_z };
      distance -= width;
      if (distance <= height) return { x: bounds.max_x, z: bounds.min_z + distance };
      distance -= height;
      if (distance <= width) return { x: bounds.max_x - distance, z: bounds.max_z };
      return { x: bounds.min_x, z: bounds.max_z - (distance - width) };
    });
  }

  rebuild();
  return {
    stats,
    updateProbe(position) {
      const sample = sampleCoastMask(position, deps.config.world.bounds, deps.config.coast, deps.seed);
      stats.coastType = sample.inCoastBand ? sample.coastType : "inland";
      stats.distanceToBorder = Number(sample.distortedDistanceToBorder.toFixed(2));
    },
    dispose() {
      folder.destroy();
      disposeChildren(root);
      root.removeFromParent();
    },
  };
}

function rectangleLine(
  bounds: BorderCoastOceanConfig["world"]["bounds"],
  color: number,
  y: number,
): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(bounds.min_x, y, bounds.min_z),
      new THREE.Vector3(bounds.max_x, y, bounds.min_z),
      new THREE.Vector3(bounds.max_x, y, bounds.max_z),
      new THREE.Vector3(bounds.min_x, y, bounds.max_z),
      new THREE.Vector3(bounds.min_x, y, bounds.min_z),
    ]),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
}

function disposeChildren(root: THREE.Group): void {
  for (const child of [...root.children]) {
    const renderable = child as THREE.Line | THREE.Points;
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
    root.remove(child);
  }
}
