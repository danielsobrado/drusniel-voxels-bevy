import * as THREE from "three";

export const BIOME_VISUAL_ACCEPTANCE_API_PROPERTY = "__drusnielBiomeVisualAcceptance";

export type BiomeVisualCaptureVariant = "all" | "terrain" | "grass" | "trees" | "understory";

export interface BiomeVisualAcceptanceApi {
  setCaptureVariant(variant: BiomeVisualCaptureVariant): void;
  restore(): void;
  info(): {
    readonly variant: BiomeVisualCaptureVariant;
    readonly roots: Readonly<Record<"grass" | "trees" | "understory", boolean>>;
    readonly farCanopyMeshes: number;
  };
}

const ROOT_NAMES = ["grass", "trees", "understory"] as const;
const CAPTURE_VARIANTS: readonly BiomeVisualCaptureVariant[] = ["all", "terrain", ...ROOT_NAMES];

type VegetationDomain = Exclude<BiomeVisualCaptureVariant, "all" | "terrain">;

export function installBiomeVisualAcceptanceApi(scene: THREE.Scene, target: object): void {
  const searchParams = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  if (searchParams?.get("acceptance") !== "1") return;

  Object.defineProperty(target, BIOME_VISUAL_ACCEPTANCE_API_PROPERTY, {
    configurable: true,
    enumerable: false,
    value: createBiomeVisualAcceptanceApi(scene),
  });
}

export function createBiomeVisualAcceptanceApi(scene: THREE.Scene): BiomeVisualAcceptanceApi {
  const originalVisibility = new WeakMap<THREE.Object3D, boolean>();
  let variant: BiomeVisualCaptureVariant = "all";

  const findRoot = (name: string): THREE.Object3D | null => scene.children.find((child) => child.name === name)
    ?? scene.getObjectByName(name)
    ?? null;

  const targets = (domain: VegetationDomain): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    const root = findRoot(domain);
    if (root) out.push(root);
    if (domain === "trees") {
      scene.traverse((object) => {
        if (object === root) return;
        if (object.userData.canopyTextureSetRevision !== undefined) out.push(object);
      });
    }
    return out;
  };

  const remember = (object: THREE.Object3D): void => {
    if (!originalVisibility.has(object)) originalVisibility.set(object, object.visible);
  };

  const allTargets = (): Readonly<Record<VegetationDomain, THREE.Object3D[]>> => ({
    grass: targets("grass"),
    trees: targets("trees"),
    understory: targets("understory"),
  });

  return {
    setCaptureVariant(next) {
      if (!CAPTURE_VARIANTS.includes(next)) {
        throw new Error(`unknown biome visual capture variant: ${String(next)}`);
      }
      variant = next;
      const resolved = allTargets();
      for (const domain of ROOT_NAMES) {
        for (const object of resolved[domain]) {
          remember(object);
          object.visible = next === "all"
            ? (originalVisibility.get(object) ?? true)
            : next === domain;
        }
      }
    },
    restore() {
      variant = "all";
      const resolved = allTargets();
      for (const domain of ROOT_NAMES) {
        for (const object of resolved[domain]) {
          remember(object);
          object.visible = originalVisibility.get(object) ?? true;
        }
      }
    },
    info() {
      const treeTargets = targets("trees");
      return {
        variant,
        roots: Object.fromEntries(ROOT_NAMES.map((name) => [name, !!findRoot(name)])) as Record<
          "grass" | "trees" | "understory",
          boolean
        >,
        farCanopyMeshes: treeTargets.filter((object) => object.userData.canopyTextureSetRevision !== undefined).length,
      };
    },
  };
}
