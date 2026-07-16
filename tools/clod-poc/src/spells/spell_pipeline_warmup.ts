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

interface IdleWindow extends Window {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

export interface SpellPipelineWarmupDeps {
  renderer: AsyncCompileRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface SpellPipelineWarmup {
  dispose(): void;
}

function isSpellObject(object: THREE.Object3D): boolean {
  return SPELL_NAME_PREFIXES.some((prefix) => object.name.startsWith(prefix));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function warmSpellPipelines(deps: SpellPipelineWarmupDeps): Promise<void> {
  const compileAsync = deps.renderer.compileAsync;
  if (typeof compileAsync !== "function") return;

  const spellObjects = deps.scene.children.filter(isSpellObject);
  for (const object of spellObjects) {
    const wasVisible = object.visible;
    object.visible = true;
    let compilePromise: Promise<unknown>;
    try {
      compilePromise = compileAsync.call(deps.renderer, object, deps.camera, deps.scene);
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
  const idleWindow = window as IdleWindow;
  let disposed = false;
  let scheduledId = 0;
  let scheduledWithIdleCallback = false;

  const run = (): void => {
    scheduledId = 0;
    if (disposed) return;
    void warmSpellPipelines(deps);
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    scheduledWithIdleCallback = true;
    scheduledId = idleWindow.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    scheduledId = window.setTimeout(run, 0);
  }

  return {
    dispose() {
      disposed = true;
      if (scheduledId === 0) return;
      if (scheduledWithIdleCallback && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(scheduledId);
      } else {
        window.clearTimeout(scheduledId);
      }
      scheduledId = 0;
    },
  };
}
