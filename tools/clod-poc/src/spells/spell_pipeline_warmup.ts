import * as THREE from "three";

const SPELL_NAME_PREFIXES = [
  "fire-spell",
  "water-spell",
  "air-spell",
  "earth-spell",
  "lightning-spell",
  "fireball-spell",
] as const;

interface AsyncCompileRenderer {
  compileAsync?: (
    object: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ) => Promise<unknown>;
}

export interface SpellPipelineWarmupDeps {
  renderer: unknown;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface SpellPipelineWarmup {
  readonly ready: Promise<void>;
  dispose(): void;
}

function hasSpellName(object: THREE.Object3D): boolean {
  return SPELL_NAME_PREFIXES.some((prefix) => object.name.startsWith(prefix));
}

function isRenderableSpellObject(object: THREE.Object3D): boolean {
  if (!hasSpellName(object) || (object as THREE.Light).isLight === true) return false;
  return (object as THREE.Mesh).isMesh === true
    || (object as THREE.Line).isLine === true
    || (object as THREE.Points).isPoints === true
    || (object as THREE.Sprite).isSprite === true;
}

function collectSpellRenderables(scene: THREE.Scene): THREE.Object3D[] {
  const renderables: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (isRenderableSpellObject(object)) renderables.push(object);
  });
  return renderables;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function warmSpellPipelines(deps: SpellPipelineWarmupDeps): Promise<void> {
  const renderer = deps.renderer as AsyncCompileRenderer;
  const compileAsync = renderer.compileAsync;
  if (typeof compileAsync !== "function") return;

  for (const object of collectSpellRenderables(deps.scene)) {
    const compileScene = new THREE.Scene();
    const proxy = object.clone(false);
    proxy.visible = true;
    compileScene.add(proxy);
    let compilePromise: Promise<unknown>;
    try {
      compilePromise = compileAsync.call(renderer, compileScene, deps.camera);
    } catch {
      continue;
    }
    await compilePromise.catch(() => undefined);
    await yieldToBrowser();
  }
}

export function scheduleSpellPipelineWarmup(deps: SpellPipelineWarmupDeps): SpellPipelineWarmup {
  void deps;
  // WebGPURenderer.compileAsync also compiles the active framebuffer/output pipeline.
  // On baseline adapters that internal pipeline can exceed max inter-stage variables,
  // invalidating subsequent command buffers. Keep spell compilation on the normal render
  // path until Three exposes a material-only compile path.
  return {
    ready: Promise.resolve(),
    dispose() {},
  };
}
