import * as THREE from "three";

const SPELL_NAME_PREFIXES = [
  "fire-spell",
  "water-spell",
  "air-spell",
  "earth-spell",
  "lightning-spell",
  "fireball-spell",
] as const;

const IDLE_TIMEOUT_MS = 1500;

interface AsyncCompileRenderer {
  compileAsync?: (
    object: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null,
  ) => Promise<unknown>;
}

interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
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
    const wasVisible = object.visible;
    object.visible = true;
    let compilePromise: Promise<unknown>;
    try {
      compilePromise = compileAsync.call(renderer, object, deps.camera, deps.scene);
    } catch {
      object.visible = wasVisible;
      continue;
    }
    object.visible = wasVisible;
    await compilePromise.catch(() => undefined);
    await yieldToBrowser();
  }
}

export function scheduleSpellPipelineWarmup(deps: SpellPipelineWarmupDeps): SpellPipelineWarmup {
  const idleWindow = window as unknown as IdleWindow;
  let disposed = false;
  let scheduledId = 0;
  let scheduledWithIdleCallback = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  const run = (): void => {
    scheduledId = 0;
    if (disposed) {
      resolveReady();
      return;
    }
    void warmSpellPipelines(deps).finally(resolveReady);
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    scheduledWithIdleCallback = true;
    scheduledId = idleWindow.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    scheduledId = window.setTimeout(run, 0);
  }

  return {
    ready,
    dispose() {
      disposed = true;
      if (scheduledId !== 0) {
        if (scheduledWithIdleCallback && typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(scheduledId);
        } else {
          window.clearTimeout(scheduledId);
        }
        scheduledId = 0;
      }
      resolveReady();
    },
  };
}
