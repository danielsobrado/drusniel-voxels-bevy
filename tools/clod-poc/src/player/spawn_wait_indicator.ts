// Progress indicator for the gated query spawn (x=/z= URL params in streaming worlds):
// while the player is held in the pre-play orbit view waiting for streamed safety pages
// and colliders around the spawn point, show what is being waited on instead of an
// apparently frozen scene.

export interface SpawnWaitProgressInput {
  safetyReady: number;
  safetyRequired: number;
  collidersLoaded: number;
}

/** 0..1 fill for the bar; safety pages dominate, colliders gate the last step. */
export function spawnWaitProgress(input: SpawnWaitProgressInput): number {
  const required = Math.max(1, input.safetyRequired);
  const safety = Math.min(1, Math.max(0, input.safetyReady / required));
  const colliders = input.collidersLoaded > 0 ? 1 : 0;
  return Math.min(1, safety * 0.9 + colliders * 0.1);
}

export function spawnWaitLabel(input: SpawnWaitProgressInput): string {
  return `Streaming spawn area… pages ${input.safetyReady}/${Math.max(1, input.safetyRequired)} · colliders ${input.collidersLoaded}`;
}

export interface SpawnWaitIndicator {
  update(input: SpawnWaitProgressInput): void;
  done(): void;
}

const NOOP_INDICATOR: SpawnWaitIndicator = { update: () => {}, done: () => {} };

export function createSpawnWaitIndicator(): SpawnWaitIndicator {
  if (typeof document === "undefined") return NOOP_INDICATOR;
  const root = document.createElement("div");
  root.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:88px",
    "transform:translateX(-50%)",
    "z-index:40",
    "min-width:280px",
    "padding:8px 14px",
    "border-radius:8px",
    "background:rgba(12,14,18,0.82)",
    "color:#dfe6ee",
    "font:12px/1.5 system-ui,sans-serif",
    "text-align:center",
    "pointer-events:none",
  ].join(";");
  const label = document.createElement("div");
  const barOuter = document.createElement("div");
  barOuter.style.cssText = "margin-top:6px;height:6px;border-radius:3px;background:rgba(255,255,255,0.14);overflow:hidden";
  const barFill = document.createElement("div");
  barFill.style.cssText = "height:100%;width:0%;border-radius:3px;background:#5db4f0;transition:width 160ms linear";
  barOuter.appendChild(barFill);
  root.appendChild(label);
  root.appendChild(barOuter);
  document.body.appendChild(root);
  let removed = false;
  return {
    update(input: SpawnWaitProgressInput) {
      if (removed) return;
      label.textContent = spawnWaitLabel(input);
      barFill.style.width = `${Math.round(spawnWaitProgress(input) * 100)}%`;
    },
    done() {
      if (removed) return;
      removed = true;
      root.remove();
    },
  };
}
