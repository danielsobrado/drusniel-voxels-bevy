import { FireFlameRenderer } from "./fire_flame_renderer.js";
import { FlameSfx } from "./flame_sfx.js";
import { defaultSpellConfig, type SpellConfig } from "./spell_config.js";

export interface SpellMenu {
  castFire: () => void;
  dispose: () => void;
}

export interface SpellMenuDeps {
  config?: SpellConfig;
  root?: HTMLElement;
}

export function createSpellMenu(deps: SpellMenuDeps = {}): SpellMenu {
  const config = deps.config ?? defaultSpellConfig;
  const root = deps.root ?? ensureMenuRoot(config.menu.rootId);
  const shouldRemoveRoot = deps.root === undefined;
  const fireRenderer = new FireFlameRenderer(config.fire.vfx);
  const flameSfx = new FlameSfx();
  let activeReset = 0;

  root.replaceChildren();
  root.setAttribute("aria-label", "Spell menu");

  const title = document.createElement("span");
  title.className = "spell-menu-title";
  title.textContent = config.menu.title;

  const slots = document.createElement("div");
  slots.className = "spell-menu-slots";

  const fireButton = document.createElement("button");
  const onFireButtonClick = (): void => castFire();
  fireButton.type = "button";
  fireButton.textContent = `🔥 ${config.fire.label}`;
  fireButton.title = `${config.fire.label} spell`;
  fireButton.setAttribute("aria-pressed", "false");
  fireButton.addEventListener("click", onFireButtonClick);

  root.addEventListener("pointerdown", stopUiPropagation);
  root.addEventListener("click", stopUiPropagation);
  slots.appendChild(fireButton);
  root.append(title, slots);

  function castFire(): void {
    window.clearTimeout(activeReset);
    fireButton.setAttribute("aria-pressed", "true");
    fireRenderer.play(config.fire.castDurationMs);
    flameSfx.play(config.fire.audio, config.fire.castDurationMs);
    activeReset = window.setTimeout(() => {
      fireButton.setAttribute("aria-pressed", "false");
    }, config.fire.castDurationMs);
  }

  return {
    castFire,
    dispose: () => {
      window.clearTimeout(activeReset);
      activeReset = 0;
      root.removeEventListener("pointerdown", stopUiPropagation);
      root.removeEventListener("click", stopUiPropagation);
      fireButton.removeEventListener("click", onFireButtonClick);
      fireRenderer.dispose();
      flameSfx.dispose();
      if (shouldRemoveRoot) root.remove();
      else root.replaceChildren();
    },
  };
}

function ensureMenuRoot(rootId: string): HTMLElement {
  const existing = document.getElementById(rootId);
  if (existing) return existing;

  const root = document.createElement("nav");
  root.id = rootId;
  document.body.appendChild(root);
  return root;
}

function stopUiPropagation(event: Event): void {
  event.stopPropagation();
}
